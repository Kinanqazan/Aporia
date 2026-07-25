import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import { Buffer } from 'node:buffer';
import { basename, dirname, extname, posix } from 'path';
import { db } from '$lib/server/database';
import { pages } from '$lib/server/schema';
import { extractTextFromJson, generateId, getActivePages } from '$lib/server/pages';
import { AssetValidationError, publicAssetUrl, removeAsset, storeImageBytes, validateImageBytes, validateImageReferences } from '$lib/server/assets';
import { validateTiptapDocument } from './validation';
import { countMarkdownTables, csvToHtml, markdownToHtml, titleFromMarkdown } from './formats';

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
	warnings: Set<string>;
	databaseCount: number;
};

export type NotionImportPreview = {
	pageCount: number;
	databaseCount: number;
	imageCount: number;
	remoteImageCount: number;
	skippedImageCount: number;
	warnings: string[];
};

export type NotionImportResult = NotionImportPreview & {
	rootPageId: string;
	rootTitle: string;
};

export class NotionImportError extends Error {}

type ImportStats = {
	imageCount: number;
	remoteImageCount: number;
	skippedImageCount: number;
};

type EmbeddedImage = {
	bytes: Uint8Array;
	filename: string;
};

/**
 * The external seam for Notion imports. Both methods accept the original ZIP so
 * previewing never leaves server-side state to clean up, and applying is fully
 * repeatable if the browser retries it.
 */
export async function previewNotionHtmlImport(archive: File): Promise<NotionImportPreview> {
	const prepared = await prepareArchive(archive);
	const stats: ImportStats = { imageCount: 0, remoteImageCount: 0, skippedImageCount: 0 };
	const imageCache = new Map<string, TiptapNode | null>();
	const resolveImage = createImageResolver(prepared, stats, imageCache, async (filename, bytes, alt) => {
		validateImageBytes(bytes);
		return imageNode({
			src: 'https://preview.invalid/notion-import-image',
			source: 'remote',
			assetId: null,
			alt,
			title: filename
		});
	});

	for (const page of prepared.pages) {
		const document = await convertHtmlToDocument(page, resolveImage, prepared.warnings);
		await assertValidImportedDocument(document, page.title);
	}

	return previewFrom(prepared, stats);
}

export async function applyNotionHtmlImport(archive: File): Promise<NotionImportResult> {
	const prepared = await prepareArchive(archive);
	const createdAssetIds: string[] = [];
	const imageCache = new Map<string, TiptapNode | null>();
	const stats: ImportStats = { imageCount: 0, remoteImageCount: 0, skippedImageCount: 0 };
	const resolveImage = createImageResolver(prepared, stats, imageCache, async (filename, bytes, alt) => {
		const asset = await storeImageBytes(filename, bytes);
		createdAssetIds.push(asset.id);
		return imageNode({
			src: publicAssetUrl(asset.id),
			source: 'upload',
			assetId: asset.id,
			alt,
			title: asset.originalFilename
		});
	});

	try {
		const documents = new Map<string, TiptapNode>();
		for (const page of prepared.pages) {
			const document = await convertHtmlToDocument(page, resolveImage, prepared.warnings);
			await assertValidImportedDocument(document, page.title);
			documents.set(page.path, document);
		}

		const result = await createImportedPages(prepared.pages, documents);
		return { ...previewFrom(prepared, stats), ...result };
	} catch (error) {
		await Promise.allSettled(createdAssetIds.map(removeAsset));
		throw error;
	}
}

async function assertValidImportedDocument(document: TiptapNode, pageTitle: string): Promise<void> {
	const validationError = validateTiptapDocument(document);
	if (validationError) throw new NotionImportError(`Could not import “${pageTitle}”: ${validationError}`);
	const imageReferenceError = await validateImageReferences(document);
	if (imageReferenceError) throw new NotionImportError(`Could not import “${pageTitle}”: ${imageReferenceError}`);
}

async function prepareArchive(archive: File): Promise<PreparedArchive> {
	const extension = extname(archive.name).toLowerCase();
	if (!['.zip', '.html', '.htm', '.md', '.markdown', '.csv'].includes(extension)) {
		throw new NotionImportError('Choose a Notion HTML, Markdown, CSV, or ZIP export file');
	}
	if (archive.size === 0) throw new NotionImportError('The selected import file is empty');
	if (archive.size > MAX_ARCHIVE_BYTES) {
		throw new NotionImportError('Notion import files must be 50 MB or smaller');
	}

	if (extension !== '.zip') {
		const text = new TextDecoder().decode(new Uint8Array(await archive.arrayBuffer()));
		if (!text.trim()) throw new NotionImportError('The selected import file is empty');
		const path = normalizeArchivePath(basename(archive.name)) || 'Page.html';
		const isCsv = extension === '.csv';
		const isMarkdown = extension === '.md' || extension === '.markdown';
		const title = isCsv
			? cleanTitle(basename(path, extension))
			: isMarkdown
				? titleFromMarkdown(text, cleanTitle(basename(path, extension)))
				: titleFromHtml(text, path);
		const html = isCsv ? csvToHtml(text, title) : isMarkdown ? markdownToHtml(text) : text;
		return {
			pages: [{ path, parentPath: null, position: 0, title, html }],
			files: new Map(),
			warnings: isCsv || isMarkdown ? new Set() : new Set(['Standalone HTML files do not include neighboring local image files.']),
			databaseCount: isCsv ? 1 : isMarkdown ? countMarkdownTables(text) : 0
		};
	}

	let files = await readZipFiles(await archive.arrayBuffer(), 'The selected file');

	const warnings = new Set<string>();
	let htmlEntries = findHtmlEntries(files);
	let markdownEntries = findMarkdownEntries(files);
	let csvEntries = findCsvEntries(files);
	if (htmlEntries.length === 0 && markdownEntries.length === 0 && csvEntries.length === 0) {
		const nestedArchives = [...files.entries()].filter(([path]) => extname(path).toLowerCase() === '.zip');
		if (nestedArchives.length === 1) {
			files = await readZipFiles(nestedArchives[0][1], 'The embedded Notion export');
			htmlEntries = findHtmlEntries(files);
			markdownEntries = findMarkdownEntries(files);
			csvEntries = findCsvEntries(files);
		}
	}

	if (htmlEntries.length === 0 && markdownEntries.length === 0 && csvEntries.length === 0) {
		throw new NotionImportError('No Notion HTML, Markdown, or CSV pages were found in this ZIP');
	}

	const pagePaths = new Set([...htmlEntries, ...markdownEntries, ...csvEntries].map((entry) => entry.path));
	const pages = [
		...htmlEntries.map((entry) => ({
			path: entry.path,
			parentPath: findParentPath(entry.path, pagePaths),
			position: entry.position,
			title: titleFromHtml(entry.html, entry.path),
			html: entry.html
		})),
		...markdownEntries.map((entry) => ({
			path: entry.path,
			parentPath: findParentPath(entry.path, pagePaths),
			position: entry.position,
			title: titleFromMarkdown(entry.text, cleanTitle(basename(entry.path, extname(entry.path)))),
			html: markdownToHtml(entry.text)
		})),
		...csvEntries.map((entry) => {
			const title = cleanTitle(basename(entry.path, extname(entry.path)));
			return {
				path: entry.path,
				parentPath: findParentPath(entry.path, pagePaths),
				position: entry.position,
				title,
				html: csvToHtml(entry.text, title)
			};
		})
	];

	return { pages, files, warnings, databaseCount: csvEntries.length + markdownEntries.reduce((count, entry) => count + countMarkdownTables(entry.text), 0) };
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
		.map(([path, bytes], position) => ({ path, position, html: new TextDecoder().decode(bytes) }))
		.filter(({ path }) => ['.html', '.htm'].includes(extname(path).toLowerCase()) && path.toLowerCase() !== 'index.html');
}

function findMarkdownEntries(files: Map<string, Uint8Array>) {
	return [...files.entries()]
		.map(([path, bytes], position) => ({ path, position, text: new TextDecoder().decode(bytes) }))
		.filter(({ path }) => ['.md', '.markdown'].includes(extname(path).toLowerCase()));
}

function findCsvEntries(files: Map<string, Uint8Array>) {
	return [...files.entries()]
		.map(([path, bytes], position) => ({ path, position, text: new TextDecoder().decode(bytes) }))
		.filter(({ path }) => extname(path).toLowerCase() === '.csv');
}

function previewFrom(prepared: PreparedArchive, stats: ImportStats): NotionImportPreview {
	return {
		pageCount: prepared.pages.length,
		databaseCount: prepared.databaseCount,
		imageCount: stats.imageCount,
		remoteImageCount: stats.remoteImageCount,
		skippedImageCount: stats.skippedImageCount,
		warnings: [...prepared.warnings]
	};
}

function decodeEmbeddedImage(source: string): EmbeddedImage | null {
	const value = source.trim();
	if (!/^data:/i.test(value)) return null;

	const separator = value.indexOf(',');
	if (separator < 0) return null;
	const metadata = value.slice(5, separator);
	const payload = value.slice(separator + 1);
	if (!/^image\//i.test(metadata.split(';', 1)[0])) return null;

	try {
		const bytes = /;base64(?:;|$)/i.test(metadata)
			? new Uint8Array(Buffer.from(payload.replace(/\s/g, ''), 'base64'))
			: Uint8Array.from(decodeURIComponent(payload), (character) => character.charCodeAt(0));
		return bytes.byteLength > 0 ? { bytes, filename: 'embedded-image' } : null;
	} catch {
		return null;
	}
}

type PersistLocalImage = (filename: string, bytes: Uint8Array, alt: string) => Promise<TiptapNode>;

function createImageResolver(
	prepared: PreparedArchive,
	stats: ImportStats,
	imageCache: Map<string, TiptapNode | null>,
	persistLocalImage: PersistLocalImage
) {
	return async (pagePath: string, src: string, alt: string): Promise<TiptapNode | null> => {
		const value = src.trim();
		if (/^https:\/\//i.test(value)) {
			stats.imageCount += 1;
			stats.remoteImageCount += 1;
			prepared.warnings.add('HTTPS images remain externally hosted and were not copied into local storage.');
			return imageNode({ src: value, source: 'remote', assetId: null, alt, title: alt });
		}

		if (/^data:/i.test(value)) {
			const cacheKey = `data:${value}`;
			if (imageCache.has(cacheKey)) {
				const cached = imageCache.get(cacheKey) ?? null;
				if (cached) stats.imageCount += 1;
				else stats.skippedImageCount += 1;
				return cached ? imageWithAlt(cached, alt) : null;
			}

			const embedded = decodeEmbeddedImage(value);
			if (!embedded) {
				stats.skippedImageCount += 1;
				prepared.warnings.add(`Skipped an invalid embedded image in “${basename(pagePath)}”.`);
				imageCache.set(cacheKey, null);
				return null;
			}

			try {
				const node = await persistLocalImage(embedded.filename, embedded.bytes, alt);
				stats.imageCount += 1;
				imageCache.set(cacheKey, node);
				return node;
			} catch (error) {
				if (!(error instanceof AssetValidationError)) throw error;
				stats.skippedImageCount += 1;
				prepared.warnings.add(`Skipped an unsupported embedded image in “${basename(pagePath)}”.`);
				imageCache.set(cacheKey, null);
				return null;
			}
		}

		const archivePath = resolveArchivePath(pagePath, value);
		if (!archivePath) {
			stats.skippedImageCount += 1;
			prepared.warnings.add(hasMalformedPercentEncoding(value)
				? `Skipped an image with malformed percent-encoding in “${basename(pagePath)}”.`
				: `Skipped an image with an unsafe or unsupported source in “${basename(pagePath)}”.`);
			return null;
		}

		if (imageCache.has(archivePath)) {
			const cached = imageCache.get(archivePath) ?? null;
			if (cached) stats.imageCount += 1;
			else stats.skippedImageCount += 1;
			return cached ? imageWithAlt(cached, alt) : null;
		}

		const bytes = prepared.files.get(archivePath);
		if (!bytes) {
			stats.skippedImageCount += 1;
			prepared.warnings.add(`Could not find an image referenced by “${basename(pagePath)}”.`);
			imageCache.set(archivePath, null);
			return null;
		}

		try {
			const node = await persistLocalImage(basename(archivePath), bytes, alt);
			stats.imageCount += 1;
			imageCache.set(archivePath, node);
			return node;
		} catch (error) {
			if (!(error instanceof AssetValidationError)) throw error;
			stats.skippedImageCount += 1;
			prepared.warnings.add(`Skipped an unsupported image in “${basename(pagePath)}”.`);
			imageCache.set(archivePath, null);
			return null;
		}
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
	const withoutQuery = value.split(/[?#]/, 1)[0].replace(/\\/g, '/');
	let decodedPath: string;
	try {
		decodedPath = withoutQuery.split('/').map((segment) => decodeURIComponent(segment)).join('/');
	} catch {
		return null;
	}
	return normalizeArchivePath(posix.join(posix.dirname(pagePath), decodedPath));
}

function hasMalformedPercentEncoding(source: string): boolean {
	try {
		source.split(/[?#]/, 1)[0].split('/').forEach((segment) => decodeURIComponent(segment));
		return false;
	} catch {
		return true;
	}
}

function findParentPath(path: string, pagePaths: Set<string>): string | null {
	let parentDirectory = posix.dirname(path);
	while (parentDirectory && parentDirectory !== '.') {
		for (const extension of ['.html', '.htm', '.md', '.markdown']) {
			const candidate = `${parentDirectory}${extension}`;
			if (pagePaths.has(candidate)) return candidate;
		}
		parentDirectory = posix.dirname(parentDirectory);
	}
	return null;
}

function titleFromHtml(html: string, path: string): string {
	const $ = cheerio.load(html);
	const title = cleanTitle($('h1').first().text()) || cleanTitle($('title').text());
	return title || cleanTitle(basename(path, extname(path))) || 'Untitled';
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
	for (const selector of ['script img', 'style img', 'noscript img', 'nav img', 'header img', 'footer img', 'svg img']) {
		if ($(selector).length > 0) warnings.add(`Images inside ${selector.slice(0, -4)} elements are unsupported and were skipped.`);
	}
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
	if (tag === 'br') return true;
	if (inlineHtmlTags.has(tag)) return !$(node).find('img').length;
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

	if (/^h[1-6]$/.test(tag)) {
		const heading = { type: 'heading', attrs: { level: Math.min(Number(tag[1]), 3) }, content: inline() };
		const images = await resolveDescendantImages($, selection, pagePath, resolveImage);
		if (images.length > 0) warnings.add('Images inside headings were moved below the heading.');
		return [heading, ...images];
	}
	if (tag === 'p') {
		return await convertBlockContent($, selection.contents().toArray(), pagePath, resolveImage, warnings);
	}
	if (tag === 'blockquote') return [{ type: 'blockquote', content: ensureBlocks(await convertBlocks($, selection.contents().toArray(), pagePath, resolveImage, warnings)) }];
	if (tag === 'pre') {
		const code = selection.find('code').first();
		const languageClass = code.attr('class') || '';
		const language = /(?:language|lang)-([\w+-]+)/i.exec(languageClass)?.[1] || null;
		const images = await resolveDescendantImages($, selection, pagePath, resolveImage);
		if (images.length > 0) warnings.add('Images inside code blocks were moved below the code block.');
		return [{ type: 'codeBlock', attrs: { language }, content: codeText(code.length ? code.text() : selection.text()) }, ...images];
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
		const summaryImages = await resolveDescendantImages($, summary, pagePath, resolveImage);
		if (summaryImages.length > 0) warnings.add('Images inside toggle summaries were moved into the toggle body.');
		return [{
			type: 'details',
			attrs: { open: selection.attr('open') !== undefined, level: toggleHeadingLevel($, selection, summary) },
			content: [
				{ type: 'detailsSummary', content: inlineFromNodes($, summary.contents().toArray()) },
				{ type: 'detailsContent', content: ensureBlocks([...summaryImages, ...await convertBlocks($, detailChildren, pagePath, resolveImage, warnings)]) }
			]
		}];
	}
	if (tag === 'ul' || tag === 'ol') return [await convertList($, selection, pagePath, resolveImage, warnings)];
	if (tag === 'li') return [await convertList($, selection.parent(), pagePath, resolveImage, warnings)];
	if (tag === 'table') {
		return [selection.attr('data-database-block') === 'true'
			? convertDatabaseTable($, selection)
			: await convertTable($, selection, pagePath, resolveImage, warnings)];
	}
	if (tag === 'iframe' || tag === 'embed' || tag === 'object') {
		warnings.add('Embeds are not supported and were skipped.');
		return [];
	}
	if (tag === 'aside') {
		warnings.add('Callouts were imported as quotes.');
		return [{ type: 'blockquote', content: ensureBlocks(await convertBlocks($, selection.contents().toArray(), pagePath, resolveImage, warnings)) }];
	}
	// Notion's HTML export wraps rich-text fragments in spans. Treating those
	// wrappers as block containers turns every fragment into its own paragraph.
	if (isInlineHtmlWrapper($, selection, tag) && selection.find('img').length === 0) {
		const content = inline();
		return content.length > 0 ? [paragraph(content)] : [];
	}

	const nested = await convertBlocks($, selection.contents().toArray(), pagePath, resolveImage, warnings);
	return nested.length > 0 ? nested : inline().length > 0 ? [paragraph(inline())] : [];
}

async function resolveDescendantImages(
	$: any,
	selection: any,
	pagePath: string,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>
): Promise<TiptapNode[]> {
	const images: TiptapNode[] = [];
	for (const element of selection.find('img').toArray()) {
		const image = await resolveImage(pagePath, $(element).attr('src') || '', $(element).attr('alt') || '');
		if (image) images.push(image);
	}
	return images;
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

async function convertBlockContent(
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
		if (node.type === 'tag' && String(node.tagName || '').toLowerCase() === 'img') {
			flushInlineBuffer();
			const image = await resolveImage(pagePath, $(node).attr('src') || '', $(node).attr('alt') || '');
			if (image) blocks.push(image);
			continue;
		}

		if (node.type === 'tag' && $(node).find('img').length > 0) {
			flushInlineBuffer();
			blocks.push(...await convertBlockContent($, $(node).contents().toArray(), pagePath, resolveImage, warnings));
			continue;
		}

		inlineBuffer.push(...inlineFromNodes($, [node]));
	}

	flushInlineBuffer();
	return blocks.length > 0 ? blocks : [paragraph([])];
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
		const itemContent = await convertBlockContent($, inlineNodes, pagePath, resolveImage, warnings);
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

async function convertTable(
	$: any,
	table: any,
	pagePath: string,
	resolveImage: (pagePath: string, src: string, alt: string) => Promise<TiptapNode | null>,
	warnings: Set<string>
): Promise<TiptapNode> {
	const rows = [];
	for (const row of table.find('tr').toArray()) {
		const cells = $(row).children('th, td').toArray();
		rows.push({
			type: 'tableRow',
			content: await Promise.all(cells.map(async (cell: any) => ({
				type: String(cell.tagName).toLowerCase() === 'th' ? 'tableHeader' : 'tableCell',
				content: await convertBlockContent($, $(cell).contents().toArray(), pagePath, resolveImage, warnings)
			})))
		});
	}
	return { type: 'table', content: rows.length > 0 ? rows : [{ type: 'tableRow', content: [{ type: 'tableCell', content: [paragraph([])] }] }] };
}

function convertDatabaseTable($: any, table: any): TiptapNode {
	type DatabaseColumn = { id: string; name: string; type: 'text' | 'number' | 'date' | 'status' | 'multi-select' };
	const headerRow = table.find('thead tr').first();
	const headerCells = headerRow.length ? headerRow.children('th, td').toArray() : table.find('tr').first().children('th, td').toArray();
	const headers = headerCells.map((cell: any, index: number) => String($(cell).text()).replace(/\s+/g, ' ').trim() || `Column ${index + 1}`);
	const bodyRows = table.find('tbody tr').length
		? table.find('tbody tr').toArray()
		: table.find('tr').toArray().slice(headerRow.length ? 1 : 0);
	const values: string[][] = bodyRows.map((row: any) => headers.map((_: string, index: number) => String($(row).children('th, td').eq(index).text()).replace(/\s+/g, ' ').trim()));
	const usedColumnIds = new Set<string>();
	const columns: DatabaseColumn[] = headers.map((name: string, index: number) => {
		const baseId = databaseColumnId(name, index);
		let id = baseId;
		let suffix = 2;
		while (usedColumnIds.has(id)) id = `${baseId}-${suffix++}`;
		usedColumnIds.add(id);
		return { id, name, type: inferDatabaseColumnType(name, values.map((row) => row[index] || '')) };
	});
	const options: Record<string, string[]> = {};
	const rows = values.map((valueRow: string[], rowIndex: number) => {
		const row: Record<string, unknown> = { id: `row-${rowIndex + 1}` };
		columns.forEach((column: DatabaseColumn, index: number) => {
			const value = valueRow[index] || '';
			if (column.type === 'number') row[column.id] = value === '' ? '' : Number(value);
			else if (column.type === 'multi-select') row[column.id] = splitDatabaseOptions(value);
			else row[column.id] = value;
		});
		return row;
	});

	for (const column of columns) {
		if (column.type === 'status' || column.type === 'multi-select') {
			const valuesForColumn: string[] = values.flatMap((row: string[]) => column.type === 'multi-select'
				? splitDatabaseOptions(row[columns.indexOf(column)] || '')
				: [row[columns.indexOf(column)] || '']);
			options[column.id] = [...new Set(valuesForColumn.filter(Boolean))];
		}
	}

	return {
		type: 'databaseBlock',
		attrs: { columns, rows, options }
	};
}

function inferDatabaseColumnType(name: string, values: string[]): 'text' | 'number' | 'date' | 'status' | 'multi-select' {
	const nonEmpty = values.filter(Boolean);
	const normalizedName = name.toLowerCase();
	if (nonEmpty.length > 0 && nonEmpty.every((value) => /^-?\d+(?:\.\d+)?$/.test(value))) return 'number';
	if (nonEmpty.length > 0 && nonEmpty.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date';
	if (/(tag|label|multi[- ]?select)/i.test(normalizedName) && nonEmpty.some((value) => /[,;]\s*/.test(value))) return 'multi-select';
	if (/(status|state|priority|select)/i.test(normalizedName) && new Set(nonEmpty).size <= 20) return 'status';
	return 'text';
}

function splitDatabaseOptions(value: string): string[] {
	return value.split(/[,;]\s*/).map((entry) => entry.trim()).filter(Boolean);
}

function databaseColumnId(name: string, index: number): string {
	const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
	return normalized || `column-${index + 1}`;
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

function imageWithAlt(node: TiptapNode, alt: string): TiptapNode {
	return { ...node, attrs: { ...node.attrs, alt } };
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
