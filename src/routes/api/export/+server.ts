import { getActivePages, getPageById } from '$lib/server/pages';
import { tiptapToMarkdown } from '$lib/server/markdown';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const idStr = url.searchParams.get('id');
	const all = url.searchParams.get('all') === 'true';

	if (idStr) {
		const id = idStr;
		const page = await getPageById(id);
		if (!page || page.isInTrash) throw error(404, 'Page not found');

		const markdown = tiptapToMarkdown(page.contentJson);
		const filename = `${toSafePathSegment(page.title)}.md`;

		return new Response(markdown, {
			headers: {
				'Content-Type': 'text/markdown; charset=utf-8',
				'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
			}
		});
	} else if (all) {
		const activePages = await getActivePages();
		if (activePages.length === 0) {
			throw error(404, 'No pages to export');
		}

		const pageMap = new Map(activePages.map(p => [p.id, p]));

		function getPagePath(page: typeof activePages[number]): string {
			const pathParts: string[] = [];
			let current = page;
			while (current.parentId !== null) {
				const parent = pageMap.get(current.parentId);
				if (!parent) break;
				pathParts.unshift(toSafePathSegment(parent.title));
				current = parent;
			}
			return pathParts.join('/');
		}

		const files: { name: string; content: string }[] = [];
		const usedFilenames = new Set<string>();

		for (const page of activePages) {
			const md = tiptapToMarkdown(page.contentJson);
			const cleanTitle = toSafePathSegment(page.title);
			const parentPath = getPagePath(page);
			
			const filename = parentPath
				? `${parentPath}/${cleanTitle}.md` 
				: `${cleanTitle}.md`;

			files.push({ name: makeUniqueFilename(filename, usedFilenames), content: md });
		}

		const zipData = createZip(files);

		return new Response(zipData as unknown as BodyInit, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': 'attachment; filename="aporia_workspace_export.zip"'
			}
		});
	}

	throw error(400, 'Missing id or all query parameter');
};

function toSafePathSegment(value: string): string {
	const sanitized = value
		.normalize('NFKC')
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
		.replace(/[. ]+$/g, '')
		.trim();

	return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : 'Untitled';
}

function makeUniqueFilename(filename: string, usedFilenames: Set<string>): string {
	const normalized = (value: string) => value.toLocaleLowerCase();
	if (!usedFilenames.has(normalized(filename))) {
		usedFilenames.add(normalized(filename));
		return filename;
	}

	const extensionIndex = filename.lastIndexOf('.');
	const base = extensionIndex === -1 ? filename : filename.slice(0, extensionIndex);
	const extension = extensionIndex === -1 ? '' : filename.slice(extensionIndex);
	let counter = 2;
	let candidate = `${base} (${counter})${extension}`;
	while (usedFilenames.has(normalized(candidate))) {
		counter += 1;
		candidate = `${base} (${counter})${extension}`;
	}

	usedFilenames.add(normalized(candidate));
	return candidate;
}

function createZip(files: { name: string; content: string }[]): Uint8Array {
	const utf8Encode = new TextEncoder();
	const localHeaders: Uint8Array[] = [];
	const centralDirectoryHeaders: Uint8Array[] = [];
	let offset = 0;

	for (const file of files) {
		const nameBytes = utf8Encode.encode(file.name);
		const contentBytes = utf8Encode.encode(file.content);
		const size = contentBytes.length;
		const crc = crc32(contentBytes);

		const localHeader = new Uint8Array(30 + nameBytes.length);
		const view = new DataView(localHeader.buffer);
		view.setUint32(0, 0x04034b50, true);
		view.setUint16(4, 10, true);
		view.setUint16(6, 0x0800, true);
		view.setUint16(8, 0, true);
		view.setUint16(10, 0, true);
		view.setUint16(12, 0, true);
		view.setUint32(14, crc, true);
		view.setUint32(18, size, true);
		view.setUint32(22, size, true);
		view.setUint16(26, nameBytes.length, true);
		view.setUint16(28, 0, true);
		localHeader.set(nameBytes, 30);

		localHeaders.push(localHeader, contentBytes);

		const cdHeader = new Uint8Array(46 + nameBytes.length);
		const cdView = new DataView(cdHeader.buffer);
		cdView.setUint32(0, 0x02014b50, true);
		cdView.setUint16(4, 20, true);
		cdView.setUint16(6, 10, true);
		cdView.setUint16(8, 0x0800, true);
		cdView.setUint16(10, 0, true);
		cdView.setUint16(12, 0, true);
		cdView.setUint16(14, 0, true);
		cdView.setUint32(16, crc, true);
		cdView.setUint32(20, size, true);
		cdView.setUint32(24, size, true);
		cdView.setUint16(28, nameBytes.length, true);
		cdView.setUint16(30, 0, true);
		cdView.setUint16(32, 0, true);
		cdView.setUint16(34, 0, true);
		cdView.setUint16(36, 0, true);
		cdView.setUint32(38, 0, true);
		cdView.setUint32(42, offset, true);
		cdHeader.set(nameBytes, 46);

		centralDirectoryHeaders.push(cdHeader);
		offset += localHeader.length + contentBytes.length;
	}

	let cdSize = 0;
	centralDirectoryHeaders.forEach(h => cdSize += h.length);

	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	eocdView.setUint32(0, 0x06054b50, true);
	eocdView.setUint16(4, 0, true);
	eocdView.setUint16(6, 0, true);
	eocdView.setUint16(8, files.length, true);
	eocdView.setUint16(10, files.length, true);
	eocdView.setUint32(12, cdSize, true);
	eocdView.setUint32(16, offset, true);
	eocdView.setUint16(20, 0, true);

	const totalLength = offset + cdSize + eocd.length;
	const zip = new Uint8Array(totalLength);
	let currentOffset = 0;
	for (const chunk of localHeaders) {
		zip.set(chunk, currentOffset);
		currentOffset += chunk.length;
	}
	for (const chunk of centralDirectoryHeaders) {
		zip.set(chunk, currentOffset);
		currentOffset += chunk.length;
	}
	zip.set(eocd, currentOffset);

	return zip;
}

const crcTable = (() => {
	const table = new Uint32Array(256);
	for (let i = 0; i < 256; i++) {
		let c = i;
		for (let j = 0; j < 8; j++) {
			c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
		}
		table[i] = c;
	}
	return table;
})();

function crc32(bytes: Uint8Array): number {
	let crc = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) {
		crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}
