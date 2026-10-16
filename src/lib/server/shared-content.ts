import {
	createPage,
	deletePermanently,
	getPageById,
	updatePage,
	updatePageContentAtVersion
} from '$lib/server/pages';
import { AssetValidationError, publicAssetUrl, removeAsset, storeAttachment, storeImage, validateImageReferences } from '$lib/server/assets';
import { pageVersion } from '$lib/server/mcp/versions';
import { validateEditorDocument } from '$lib/server/mcp/document';
import { withUploadActivity, UploadActivityError } from '$lib/server/upload-activity';

const MAX_TITLE_LENGTH = 160;
const MAX_TEXT_LENGTH = 50_000;
const MAX_URL_LENGTH = 4_096;

export type SharedContentInput = {
	title?: unknown;
	text?: unknown;
	url?: unknown;
	bookmarkTitle?: unknown;
};

export class SharedContentError extends Error {
	constructor(message: string, readonly status = 400) {
		super(message);
		this.name = 'SharedContentError';
	}
}

type TiptapNode = Record<string, unknown>;

function cleanText(value: unknown, maxLength: number): string {
	if (typeof value !== 'string') return '';
	return value
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.trim()
		.slice(0, maxLength);
}

function safeHttpUrl(value: unknown): string {
	const candidate = cleanText(value, MAX_URL_LENGTH);
	if (!candidate) return '';
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
		if (!parsed.hostname || parsed.username || parsed.password) return '';
		return parsed.toString();
	} catch {
		return '';
	}
}

export async function createPageFromSharedContent(input: SharedContentInput) {
	const titleInput = cleanText(input.title, MAX_TITLE_LENGTH);
	const text = cleanText(input.text, MAX_TEXT_LENGTH);
	const url = safeHttpUrl(input.url);
	if (!titleInput && !text && !url) {
		throw new Error('The shared item did not contain text or a web link.');
	}

	const titleFromText = text.split(/\r?\n/, 1)[0]?.trim() || '';
	const title = (titleInput || titleFromText || url || 'Shared from Android').slice(0, MAX_TITLE_LENGTH);
	const content: TiptapNode[] = [];
	const linkNode = url ? {
		type: 'text',
		text: url,
		marks: [{ type: 'link', attrs: { href: url } }]
	} : null;

	if (text && url && text.includes(url)) {
		const linkStart = text.indexOf(url);
		const paragraph: TiptapNode[] = [];
		if (linkStart > 0) paragraph.push({ type: 'text', text: text.slice(0, linkStart) });
		paragraph.push(linkNode!);
		const afterLink = text.slice(linkStart + url.length);
		if (afterLink) paragraph.push({ type: 'text', text: afterLink });
		content.push({ type: 'paragraph', content: paragraph });
	} else {
		if (text && text !== url) {
			content.push({ type: 'paragraph', content: [{ type: 'text', text }] });
		}
	}
	if (url && !text.includes(url)) {
		content.push({
			type: 'paragraph',
			content: [linkNode!]
		});
	}
	if (content.length === 0 && titleInput) {
		content.push({ type: 'paragraph', content: [{ type: 'text', text: titleInput }] });
	}

	const page = await createPage(null, title);
	await updatePage(page.id, {
		contentJson: JSON.stringify({ type: 'doc', content })
	});
	return page;
}

export async function appendSharedLinkToPage(pageId: unknown, input: SharedContentInput) {
	try {
		return await withUploadActivity(() => appendSharedLink(pageId, input));
	} catch (error) {
		if (error instanceof UploadActivityError) throw new SharedContentError(error.message, error.status);
		throw error;
	}
}

async function appendSharedLink(pageId: unknown, input: SharedContentInput) {
	if (typeof pageId !== 'string' || !pageId) throw new SharedContentError('Choose a page to add this link to.');
	const page = await getPageById(pageId);
	if (!page || page.isInTrash) throw new SharedContentError('That page is no longer available.', 404);
	if (page.isLocked) throw new SharedContentError('Unlock the selected page before adding a link.', 423);

	const url = safeHttpUrl(input.url);
	if (!url) throw new SharedContentError('The shared item does not contain a valid web link.');
	const suppliedTitle = cleanText(input.bookmarkTitle, MAX_TITLE_LENGTH)
		|| cleanText(input.title, MAX_TITLE_LENGTH);
	const title = suppliedTitle || new URL(url).hostname.replace(/^www\./i, '');

	let document: { type: string; content: unknown[] };
	try {
		document = page.contentJson
			? JSON.parse(page.contentJson)
			: { type: 'doc', content: [] };
	} catch {
		throw new SharedContentError('The selected page has invalid content.', 500);
	}
	if (document.type !== 'doc' || !Array.isArray(document.content)) {
		throw new SharedContentError('The selected page has invalid content.', 500);
	}

	const nextDocument = {
		...document,
		content: [...document.content, { type: 'linkBookmark', attrs: { url, title } }]
	};
	const documentError = validateEditorDocument(nextDocument);
	if (documentError) throw new SharedContentError(`Could not add this link: ${documentError}`, 400);

	const contentJson = JSON.stringify(nextDocument);
	const updatedPage = await updatePageContentAtVersion(
		page.id,
		contentJson,
		pageVersion(page.revision),
		{ isLocked: page.isLocked, contentJson: page.contentJson }
	);
	if (!updatedPage) {
		throw new SharedContentError('This page changed while the link was being added. Please choose it again.', 409);
	}
	return updatedPage;
}

export async function appendSharedFilesToPage(pageId: unknown, files: File[], suppliedShareId?: unknown) {
	try {
		return await withUploadActivity(() => appendSharedFiles(pageId, files, suppliedShareId));
	} catch (error) {
		if (error instanceof UploadActivityError) throw new SharedContentError(error.message, error.status);
		throw error;
	}
}

async function appendSharedFiles(pageId: unknown, files: File[], suppliedShareId?: unknown) {
	if (typeof pageId !== 'string' || !pageId) throw new SharedContentError('Choose a page for these files.');
	if (files.length === 0 || files.length > 5) throw new SharedContentError('Share between one and five files at a time.');
	if (files.reduce((total, file) => total + file.size, 0) > 25 * 1024 * 1024) {
		throw new SharedContentError('Shared files must total 25 MB or less.');
	}

	const page = await getPageById(pageId);
	if (!page || page.isInTrash) throw new SharedContentError('That page is no longer available.', 404);
	if (page.isLocked) throw new SharedContentError('Unlock the selected page before adding files.', 423);

	let document: { type: string; content: unknown[] };
	try {
		document = page.contentJson ? JSON.parse(page.contentJson) : { type: 'doc', content: [] };
	} catch {
		throw new SharedContentError('The selected page has invalid content.', 500);
	}
	if (document.type !== 'doc' || !Array.isArray(document.content)) {
		throw new SharedContentError('The selected page has invalid content.', 500);
	}
	const shareId = typeof suppliedShareId === 'string' && suppliedShareId.length <= 64 ? suppliedShareId : null;
	if (shareId && containsSharedItem(document, shareId)) return page;

	const storedAssets: Awaited<ReturnType<typeof storeImage>>[] = [];
	try {
		for (const file of files) {
			if (file.type.toLowerCase().startsWith('image/')) {
				try {
					storedAssets.push(await storeImage(file));
				} catch (error) {
					if (!(error instanceof AssetValidationError)) throw error;
					const genericFile = new File([await file.arrayBuffer()], file.name, { type: 'application/octet-stream' });
					storedAssets.push(await storeAttachment(genericFile));
				}
			} else {
				storedAssets.push(await storeAttachment(file));
			}
		}
		const nextDocument = {
			...document,
			content: [...document.content, ...storedAssets.map((asset) => asset.mimeType.startsWith('image/') ? ({
				type: 'image',
				attrs: { src: publicAssetUrl(asset.id), alt: '', title: asset.originalFilename, source: 'upload', assetId: asset.id, shareId }
			}) : ({
				type: 'fileAttachment',
				attrs: { assetId: asset.id, fileName: asset.originalFilename, mimeType: asset.mimeType, size: asset.byteSize, shareId }
			}))]
		};
		const imageReferenceError = await validateImageReferences(nextDocument);
		if (imageReferenceError) throw new SharedContentError(imageReferenceError);
		const documentError = validateEditorDocument(nextDocument);
		if (documentError) throw new SharedContentError(`Could not add these files: ${documentError}`);

		const updatedPage = await updatePageContentAtVersion(
			page.id,
			JSON.stringify(nextDocument),
			pageVersion(page.revision),
			{ isLocked: page.isLocked, contentJson: page.contentJson }
		);
		if (!updatedPage) {
			throw new SharedContentError('This page changed while the files were being added. Please choose it again.', 409);
		}
		return updatedPage;
	} catch (error) {
		await Promise.allSettled(storedAssets.map((asset) => removeAsset(asset.id)));
		if (error instanceof AssetValidationError) throw new SharedContentError(error.message);
		throw error;
	}
}

function containsSharedItem(document: unknown, shareId: string): boolean {
	const visit = (node: any): boolean => {
		if (!node || typeof node !== 'object') return false;
		if (node.attrs?.shareId === shareId) return true;
		return Array.isArray(node.content) && node.content.some(visit);
	};
	return visit(document);
}

export async function createPageFromSharedFiles(input: SharedContentInput, files: File[]) {
	if (files.length === 0) return createPageFromSharedContent(input);
	const firstFileName = cleanText(files[0]?.name, MAX_TITLE_LENGTH);
	const page = await createPageFromSharedContent({ ...input, title: cleanText(input.title, MAX_TITLE_LENGTH) || firstFileName });
	try {
		return await appendSharedFilesToPage(page.id, files);
	} catch (error) {
		await deletePermanently(page.id);
		throw error;
	}
}
