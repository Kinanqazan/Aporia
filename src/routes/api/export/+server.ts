import { getActivePages, getPageById } from '$lib/server/pages';
import { tiptapToMarkdown } from '$lib/server/markdown';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import JSZip from 'jszip';

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

		const zip = new JSZip();
		const usedFilenames = new Set<string>();

		for (const page of activePages) {
			const md = tiptapToMarkdown(page.contentJson);
			const cleanTitle = toSafePathSegment(page.title);
			const parentPath = getPagePath(page);
			
			const filename = parentPath
				? `${parentPath}/${cleanTitle}.md` 
				: `${cleanTitle}.md`;

			const uniqueName = makeUniqueFilename(filename, usedFilenames);
			zip.file(uniqueName, md);
		}

		const zipData = await zip.generateAsync({ type: 'uint8array' });

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
