import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { basename, dirname, extname, posix } from 'path';
import { db } from '$lib/server/database';
import { pages } from '$lib/server/schema';
import { extractTextFromJson, generateId, getActivePages } from '$lib/server/pages';
import { publicAssetUrl, removeAsset, storeImageBytes } from '$lib/server/assets';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 1_000;
const MAX_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;

type TiptapNode = {
	type: string;
	attrs?: Record<string, unknown>;
	content?: TiptapNode[];
	text?: string;
	marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

const inlineHtmlTags = new Set([
	'a', 'abbr', 'b', 'cite', 'code', 'del', 'em', 'i', 'label', 'mark', 'q', 's', 'small', 'span',
	'strike', 'strong', 'sub', 'sup', 'time', 'u', 'var'
]);

type ImportedPage = {
	path: string;
	parentPath: string | null;
	position: number;
	title: string;
	html: string;
};

type PreparedArchive = {
	pages: ImportedPage[];
	files: Map<string, Uint8Array>;
	localImagePaths: Set<string>;
	warnings: Set<string>;
};

export type NotionImportPreview = {
	pageCount: number;
	imageCount: number;
	warnings: string[];
};

export type NotionImportResult = NotionImportPreview & {
	rootPageId: string;
	rootTitle: string;
};

export class NotionImportError extends Error {}

/**
 * The external seam for Notion imports. Both methods accept the original ZIP so
 * previewing never leaves server-side state to clean up, and applying is fully
 * repeatable if the browser retries it.
 */
export async function previewNotionHtmlImport(archive: File): Promise<NotionImportPreview> {
	const prepared = await prepareArchive(archive);
	return previewFrom(prepared);
}

export async function applyNotionHtmlImport(archive: File): Promise<NotionImportResult> {
	const prepared = await prepareArchive(archive);
	const createdAssetIds: string[] = [];
	const imageCache = new Map<string, TiptapNode | null>();

	const resolveImage = async (pagePath: string, src: string, alt: string): Promise<TiptapNode | null> => {
		if (/^https:\/\//i.test(src)) {
			return imageNode({ src, source: 'remote', assetId: null, alt, title: alt });
		}

		const archivePath = resolveArchivePath(pagePath, src);
		if (!archivePath) {
			prepared.warnings.add('Skipped an image with an unsafe or unsupported source.');
			return null;
		}

		if (imageCache.has(archivePath)) return imageCache.get(archivePath) ?? null;
		const bytes = prepared.files.get(archivePath);
		if (!bytes) {
			prepared.warnings.add(`Could not find an image referenced by “${basename(pagePath)}”.`);
			imageCache.set(archivePath, null);
			return null;
		}

		try {
			const asset = await storeImageBytes(basename(archivePath), bytes);
			createdAssetIds.push(asset.id);
			const node = imageNode({
				src: publicAssetUrl(asset.id),
				source: 'upload',
				assetId: asset.id,
				alt,
				title: asset.originalFilename
			});
			imageCache.set(archivePath, node);
			return node;
		} catch (error) {
			prepared.warnings.add(`Skipped an unsupported image in “${basename(pagePath)}”.`);
			imageCache.set(archivePath, null);
			return null;
		}
	};

	try {
		const documents = new Map<string, TiptapNode>();
		for (const page of prepared.pages) {
			documents.set(page.path, await convertHtmlToDocument(page, resolveImage, prepared.warnings));
		}

		const result = await createImportedPages(prepared.pages, documents);
		return { ...previewFrom(prepared), ...result };
	} catch (error) {
		await Promise.allSettled(createdAssetIds.map(removeAsset));
		throw error;
	}
}

async function prepareArchive(archive: File): Promise<PreparedArchive> {
	if (!archive.name.toLowerCase().endsWith('.zip')) {
		throw new NotionImportError('Choose a Notion HTML export ZIP file');
	}
	if (archive.size === 0) throw new NotionImportError('The export ZIP is empty');
	if (archive.size > MAX_ARCHIVE_BYTES) {
		throw new NotionImportError('Notion export ZIP files must be 50 MB or smaller');
	}

	let files = await readZipFiles(await archive.arrayBuffer(), 'The selected file');

	const warnings = new Set<string>();
	let htmlEntries = findHtmlEntries(files);
	if (htmlEntries.length === 0) {
		const nestedArchives = [...files.entries()].filter(([path]) => extname(path).toLowerCase() === '.zip');
		if (nestedArchives.length === 1) {
			files = await readZipFiles(nestedArchives[0][1], 'The embedded Notion export');
			htmlEntries = findHtmlEntries(files);
		}
	}

	if (htmlEntries.length === 0) {
		throw new NotionImportError('No Notion HTML pages were found in this ZIP');
	}

	const pagePaths = new Set(htmlEntries.map((entry) => entry.path));
	const pages = htmlEntries.map((entry) => ({
		path: entry.path,
		parentPath: findParentPath(entry.path, pagePaths),
		position: entry.position,
		title: titleFromHtml(entry.html, entry.path),
		html: entry.html
	}));

	const localImagePaths = new Set<string>();
	for (const page of pages) {
		const $ = cheerio.load(page.html);
		$('img[src]').each((_, element) => {
			const source = $(element).attr('src') || '';
			const path = resolveArchivePath(page.path, source);
			if (path && files.has(path)) localImagePaths.add(path);
			else if (source && !/^https:\/\//i.test(source)) warnings.add('Some non-local images could not be imported.');
		});
	}

	if ([...files.keys()].some((path) => extname(path).toLowerCase() === '.csv')) {
		warnings.add('CSV files were found but database import is not available yet.');
	}

	return { pages, files, localImagePaths, warnings };
}

async function readZipFiles(contents: ArrayBuffer | Uint8Array, label: string): Promise<Map<string, Uint8Array>> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(contents, { createFolders: false });
	} catch {
		throw new NotionImportError(`${label} is not a valid ZIP archive`);
	}

	const entries = Object.values(zip.files).filter((entry) => !entry.dir);
	if (entries.length === 0) throw new NotionImportError(`${label} contains no files`);
	if (entries.length > MAX_ARCHIVE_FILES) {
		throw new NotionImportError(`Notion export ZIP files may contain at most ${MAX_ARCHIVE_FILES} files`);
	}

	let totalUncompressedBytes = 0;
	const files = new Map<string, Uint8Array>();
	for (const entry of entries) {
		const path = normalizeArchivePath(entry.name);
		if (!path) throw new NotionImportError(`${label} contains an unsafe file path`);
		const knownSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
		if (knownSize && knownSize > MAX_UNCOMPRESSED_BYTES) {
			throw new NotionImportError(`${label} contains a file that is too large`);
		}
		const bytes = await entry.async('uint8array');
		totalUncompressedBytes += bytes.byteLength;
		if (totalUncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
			throw new NotionImportError(`${label} expands to more than 250 MB`);
		}
		files.set(path, bytes);
	}
	return files;
}

function findHtmlEntries(files: Map<string, Uint8Array>) {
	return [...files.entries()]
		.filter(([path]) => extname(path).toLowerCase() === '.html' && path.toLowerCase() !== 'index.html')
		.map(([path, bytes], position) => ({ path, position, html: new TextDecoder().decode(bytes) }));
}

function previewFrom(prepared: PreparedArchive): NotionImportPreview {
	return {
		pageCount: prepared.pages.length,
		imageCount: prepared.localImagePaths.size,
		warnings: [...prepared.warnings]
	};
}

function normalizeArchivePath(path: string): string | null {
	const normalized = posix.normalize(path.replace(/\\/g, '/')).replace(/^\.\//, '');
	if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) return null;
	return normalized;
}

function resolveArchivePath(pagePath: string, source: string): string | null {
	const value = source.trim();
	if (!value || /^data:/i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return null;
	const withoutQuery = value.split(/[?#]/, 1)[0];
	return normalizeArchivePath(posix.join(posix.dirname(pagePath), withoutQuery));
}

function findParentPath(path: string, pagePaths: Set<string>): string | null {
	let parentDirectory = posix.dirname(path);
	while (parentDirectory && parentDirectory !== '.') {
		const candidate = `${parentDirectory}.html`;
		if (pagePaths.has(candidate)) return candidate;
		parentDirectory = posix.dirname(parentDirectory);
	}
	return null;
}

function titleFromHtml(html: string, path: string): string {
	const $ = cheerio.load(html);
	const title = cleanTitle($('h1').first().text()) || cleanTitle($('title').text());
	return title || cleanTitle(basename(path, '.html')) || 'Untitled';
}

function cleanTitle(value: string): string {
	return value
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\s+[a-f0-9]{32}$/i, '')
		.replace(/\s+-\s+notion$/i, '')
		.trim();
}

async function convertHtmlToDocument(
	page: ImportedPage,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>,
	warnings: Set<string>
): Promise<TiptapNode> {
	const $ = cheerio.load(page.html);
	$('script, style, noscript, nav, header, footer, svg, link, meta').remove();
	const root = $('article').first().length ? $('article').first() : $('main').first().length ? $('main').first() : $('body').first();
	const content = await convertBlocks($, root.contents().toArray(), page.path, resolveImage, warnings);

	const firstBlock = content[0];
	if (firstBlock?.type === 'heading' && firstBlock.attrs?.level === 1 && textFromNode(firstBlock) === page.title) {
		content.shift();
	}

	return { type: 'doc', content };
}

async function convertBlocks(
	$: any,
	nodes: any[],
	pagePath: string,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>,
	warnings: Set<string>
): Promise<TiptapNode[]> {
	const blocks: TiptapNode[] = [];
	let inlineBuffer: TiptapNode[] = [];
	const flushInlineBuffer = () => {
		const content = mergeAdjacentText(inlineBuffer);
		if (content.length > 0) blocks.push(paragraph(content));
		inlineBuffer = [];
	};

	for (const node of nodes) {
		if (node.type === 'text' && !String(node.data || '').trim()) continue;
		// Notion sometimes splits one rich-text paragraph into adjacent <div>
		// wrappers. Keep wrappers that contain only inline content together, so
		// emphasis boundaries do not become paragraph boundaries.
		if (isInlineFragment($, node)) {
			inlineBuffer.push(...inlineFromNodes($, [node]));
			continue;
		}
		flushInlineBuffer();
		if (node.type !== 'tag') continue;
		blocks.push(...await convertBlock($, node, pagePath, resolveImage, warnings));
	}
	flushInlineBuffer();
	return blocks;
}

function isInlineFragment($: any, node: any): boolean {
	if (node.type === 'text') return Boolean(String(node.data || '').trim());
	if (node.type !== 'tag') return false;

	const tag = String(node.tagName || '').toLowerCase();
	if (tag === 'br' || inlineHtmlTags.has(tag)) return true;
	return tag === 'div' && hasOnlyInlineContent($, $(node));
}

function hasOnlyInlineContent($: any, selection: any): boolean {
	return selection.contents().toArray().every((child: any) => {
		if (child.type === 'text') return true;
		if (child.type !== 'tag') return false;

		const tag = String(child.tagName || '').toLowerCase();
		return tag === 'br' || inlineHtmlTags.has(tag) || (tag === 'div' && hasOnlyInlineContent($, $(child)));
	});
}

async function convertBlock(
	$: any,
	element: any,
	pagePath: string,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>,
	warnings: Set<string>
): Promise<TiptapNode[]> {
	const tag = String(element.tagName || '').toLowerCase();
	const selection = $(element);
	const inline = () => inlineFromNodes($, selection.contents().toArray());

	if (/^h[1-6]$/.test(tag)) return [{ type: 'heading', attrs: { level: Math.min(Number(tag[1]), 3) }, content: inline() }];
	if (tag === 'p') {
		const image = await soleImage($, selection, pagePath, resolveImage);
		return image ? [image] : [paragraph(inline())];
	}
	if (tag === 'blockquote') return [{ type: 'blockquote', content: ensureBlocks(await convertBlocks($, selection.contents().toArray(), pagePath, resolveImage, warnings)) }];
	if (tag === 'pre') {
		const code = selection.find('code').first();
		const languageClass = code.attr('class') || '';
		const language = /(?:language|lang)-([\w+-]+)/i.exec(languageClass)?.[1] || null;
		return [{ type: 'codeBlock', attrs: { language }, content: codeText(code.length ? code.text() : selection.text()) }];
	}
	if (tag === 'hr') return [{ type: 'horizontalRule' }];
	if (tag === 'img') {
		const image = await resolveImage(pagePath, selection.attr('src') || '', selection.attr('alt') || '');
		return image ? [image] : [];
	}
	if (tag === 'figure') {
		const image = await soleImage($, selection, pagePath, resolveImage);
		if (image) return [image];
		return convertBlocks($, selection.contents().toArray(), pagePath, resolveImage, warnings);
	}
	if (tag === 'details') {
		const summary = selection.children('summary').first();
		const detailChildren = selection.contents().toArray().filter((child: any) => child !== summary.get(0));
		return [{
			type: 'details',
			attrs: { open: selection.attr('open') !== undefined, level: toggleHeadingLevel($, selection, summary) },
			content: [
				{ type: 'detailsSummary', content: inlineFromNodes($, summary.contents().toArray()) },
				{ type: 'detailsContent', content: ensureBlocks(await convertBlocks($, detailChildren, pagePath, resolveImage, warnings)) }
			]
		}];
	}
	if (tag === 'ul' || tag === 'ol') return [await convertList($, selection, pagePath, resolveImage, warnings)];
	if (tag === 'li') return [await convertList($, selection.parent(), pagePath, resolveImage, warnings)];
	if (tag === 'table') return [convertTable($, selection)];
	if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
		warnings.add('Embeds are not supported and were skipped.');
		return [];
	}
	if (tag === 'aside') {
		warnings.add('Callouts were imported as quotes.');
		return [{ type: 'blockquote', content: [paragraph(inline())] }];
	}
	// Notion's HTML export wraps rich-text fragments in spans. Treating those
	// wrappers as block containers turns every fragment into its own paragraph.
	if (isInlineHtmlWrapper($, selection, tag)) {
		const content = inline();
		return content.length > 0 ? [paragraph(content)] : [];
	}

	const nested = await convertBlocks($, selection.contents().toArray(), pagePath, resolveImage, warnings);
	return nested.length > 0 ? nested : inline().length > 0 ? [paragraph(inline())] : [];
}

function isInlineHtmlWrapper($: any, selection: any, tag: string): boolean {
	if (inlineHtmlTags.has(tag)) return true;
	return /(?:^|;)\s*display\s*:\s*inline(?:-block)?\b/i.test(selection.attr('style') || '');
}

function toggleHeadingLevel($: any, details: any, summary: any): 1 | 2 | 3 {
	const candidates = [
		summary.attr('data-heading-level'),
		details.attr('data-heading-level'),
		summary.attr('data-level'),
		details.attr('data-level'),
		summary.attr('aria-level')
	];
	for (const candidate of candidates) {
		const level = Number(candidate);
		if (level === 1 || level === 2 || level === 3) return level;
	}

	const heading = summary.find('h1, h2, h3').first();
	if (heading.length) return Number(String(heading.get(0).tagName).slice(1)) as 1 | 2 | 3;

	const classNames = [details.attr('class'), summary.attr('class')].filter(Boolean).join(' ');
	const classMatch = /(?:^|\s)(?:notion-)?(?:heading-?|toggle-?)?h([1-3])(?:\s|$)/i.exec(classNames)
		|| /(?:^|\s)(?:notion-)?(?:heading|toggle|level)-?([1-3])(?:\s|$)/i.exec(classNames);
	if (classMatch) return Number(classMatch[1]) as 1 | 2 | 3;

	return 1;
}

async function soleImage(
	$: any,
	selection: any,
	pagePath: string,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>
): Promise<TiptapNode | null> {
	const images = selection.find('img').toArray();
	const nonImageText = selection.text().replace(/\s+/g, ' ').trim();
	if (images.length !== 1 || nonImageText) return null;
	const image = $(images[0]);
	return resolveImage(pagePath, image.attr('src') || '', image.attr('alt') || '');
}

async function convertList(
	$: any,
	list: any,
	pagePath: string,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>,
	warnings: Set<string>
): Promise<TiptapNode> {
	const items = list.children('li').toArray();
	const taskList = items.some((item: any) => $(item).find('input[type="checkbox"]').length > 0);
	const convertedItems: TiptapNode[] = [];

	for (const item of items) {
		const itemSelection = $(item);
		const nestedLists = itemSelection.children('ul, ol').toArray();
		const inlineNodes = itemSelection.contents().toArray().filter((child: any) => child.type === 'text' || (child.type === 'tag' && child.tagName !== 'ul' && child.tagName !== 'ol'));
		const itemContent: TiptapNode[] = [paragraph(inlineFromNodes($, inlineNodes))];
		for (const nested of nestedLists) itemContent.push(await convertList($, $(nested), pagePath, resolveImage, warnings));

		if (taskList) {
			const checkbox = itemSelection.find('input[type="checkbox"]').first();
			convertedItems.push({ type: 'taskItem', attrs: { checked: checkbox.attr('checked') !== undefined }, content: itemContent });
		} else {
			convertedItems.push({ type: 'listItem', content: itemContent });
		}
	}

	return { type: taskList ? 'taskList' : list.is('ol') ? 'orderedList' : 'bulletList', content: convertedItems };
}

function convertTable($: any, table: any): TiptapNode {
	const rows = table.find('tr').toArray().map((row: any) => {
		const cells = $(row).children('th, td').toArray();
		return {
			type: 'tableRow',
			content: cells.map((cell: any) => ({
				type: String(cell.tagName).toLowerCase() === 'th' ? 'tableHeader' : 'tableCell',
				content: [paragraph(inlineFromNodes($, $(cell).contents().toArray()))]
			}))
		};
	});
	return { type: 'table', content: rows.length > 0 ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph([])] }] }] };
}

function inlineFromNodes($: any, nodes: any[], marks: TiptapNode['marks'] = []): TiptapNode[] {
	const output: TiptapNode[] = [];
	for (const node of nodes) {
		if (node.type === 'text') {
			const text = String(node.data || '').replace(/\s+/g, ' ');
			if (text) output.push({ type: 'text', text, ...(marks.length ? { marks } : {}) });
			continue;
		}
		if (node.type !== 'tag') continue;
		const tag = String(node.tagName || '').toLowerCase();
		if (tag === 'br') {
			output.push({ type: 'hardBreak' });
			continue;
		}
		if (tag === 'img' || tag === 'input') continue;
		const nextMarks = [...marks];
		const addMark = (type: string, attrs?: Record<string, unknown>) => {
			if (!nextMarks.some((mark) => mark.type === type && JSON.stringify(mark.attrs || {}) === JSON.stringify(attrs || {}))) {
				nextMarks.push(attrs ? { type, attrs } : { type });
			}
		};
		if (tag === 'strong' || tag === 'b') addMark('bold');
		else if (tag === 'em' || tag === 'i') addMark('italic');
		else if (tag === 's' || tag === 'strike' || tag === 'del') addMark('strike');
		else if (tag === 'code') addMark('code');
		else if (tag === 'a') {
			const href = $(node).attr('href');
			if (href && (/^https?:\/\//i.test(href) || href.startsWith('/') || href.startsWith('#'))) addMark('link', { href });
		}
		const style = String($(node).attr('style') || '').toLowerCase();
		if (/font-style\s*:\s*(italic|oblique)/.test(style)) addMark('italic');
		if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) addMark('bold');
		if (/text-decoration(?:-line)?\s*:\s*[^;]*line-through/.test(style)) addMark('strike');
		output.push(...inlineFromNodes($, $(node).contents().toArray(), nextMarks));
	}
	return mergeAdjacentText(output);
}

function mergeAdjacentText(nodes: TiptapNode[]): TiptapNode[] {
	return nodes.reduce<TiptapNode[]>((result, node) => {
		const previous = result[result.length - 1];
		if (node.type === 'text' && previous?.type === 'text' && JSON.stringify(node.marks || []) === JSON.stringify(previous.marks || [])) {
			previous.text = `${previous.text || ''}${node.text || ''}`;
		} else result.push(node);
		return result;
	}, []);
}

function paragraph(content: TiptapNode[]): TiptapNode {
	return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function ensureBlocks(content: TiptapNode[]): TiptapNode[] {
	return content.length ? content : [paragraph([])];
}

function codeText(text: string): TiptapNode[] | undefined {
	return text ? [{ type: 'text', text }] : undefined;
}

function imageNode(attrs: Record<string, unknown>): TiptapNode {
	return { type: 'image', attrs };
}

function textFromNode(node: TiptapNode): string {
	if (node.type === 'text') return node.text || '';
	return (node.content || []).map(textFromNode).join('').replace(/\s+/g, ' ').trim();
}

async function createImportedPages(importedPages: ImportedPage[], documents: Map<string, TiptapNode>): Promise<{ rootPageId: string; rootTitle: string }> {
	const rootTitle = `Notion import — ${new Date().toLocaleDateString('en-CA')}`;
	const rootPageId = generateId();
	const activePages = await getActivePages();
	const rootPosition = activePages.filter((page) => page.parentId === null).length;
	const orderedPages = [...importedPages].sort((a, b) => depth(a.path) - depth(b.path) || a.position - b.position);
	const idsByPath = new Map<string, string>();
	const siblingPositions = new Map<string, number>();
	const now = new Date().toISOString();

	db.transaction((tx) => {
		tx.insert(pages).values(pageValues(rootPageId, null, rootPosition, rootTitle, { type: 'doc', content: [] }, now)).run();
		for (const importedPage of orderedPages) {
			const id = generateId();
			const parentId = importedPage.parentPath ? idsByPath.get(importedPage.parentPath) || rootPageId : rootPageId;
			const position = siblingPositions.get(parentId) || 0;
			siblingPositions.set(parentId, position + 1);
			const document = documents.get(importedPage.path) || { type: 'doc', content: [] };
			tx.insert(pages).values(pageValues(id, parentId, position, importedPage.title, document, now)).run();
			idsByPath.set(importedPage.path, id);
		}
	});

	return { rootPageId, rootTitle };
}

function pageValues(id: string, parentId: string | null, position: number, title: string, document: TiptapNode, now: string) {
	const contentJson = JSON.stringify(document);
	return {
		id,
		parentId,
		position,
		title,
		icon: 'lucide:file-text',
		contentJson,
		contentText: extractTextFromJson(contentJson),
		schemaVersion: 1,
		revision: 1,
		isLocked: 0,
		isInTrash: 0,
		createdAt: now,
		updatedAt: now,
		trashAt: null
	};
}

function depth(path: string): number {
	return path.split('/').length;
}
