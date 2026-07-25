import assert from 'node:assert/strict';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'vite';
import JSZip from 'jszip';

const temporaryRoot = join(process.cwd(), 'tmp', `notion-import-regression-${process.pid}`);
await rm(temporaryRoot, { recursive: true, force: true });
await mkdir(temporaryRoot, { recursive: true });

process.env.DATABASE_URL = join(temporaryRoot, 'app.db');
process.env.UPLOAD_DIR = join(temporaryRoot, 'uploads');

let vite;
let sqlite;

try {
	vite = await createServer({
		configFile: 'vite.config.ts',
		server: { middlewareMode: true, watch: null },
		logLevel: 'error'
	});

	const importer = await vite.ssrLoadModule('/src/lib/server/notion-import/html.ts');
	const pagesModule = await vite.ssrLoadModule('/src/lib/server/pages.ts');
	const databaseModule = await vite.ssrLoadModule('/src/lib/server/database.ts');
	sqlite = databaseModule.sqlite;

	const zip = new JSZip();
	zip.file('Page.html', `<!doctype html><html><head><title>Page</title></head><body><article>
		<h1>Page</h1>
		<h2>Heading <img src="Assets/caption.jpg" alt="heading"></h2>
		<p><img src="Assets/photo%20one.png" alt="encoded"></p>
		<p>Caption <img src="Assets/caption.jpg" alt="caption"></p>
		<ul><li>List item <img src="Assets/list.gif" alt="list"></li></ul>
		<table><tr><td><img src="Assets/table.webp" alt="table"></td></tr></table>
		<details><summary>Toggle <img src="Assets/caption.jpg" alt="toggle"></summary><p>Body</p></details>
		<p><img src="https://example.com/external.png" alt="external"></p>
		<p><img src="Assets/missing.png" alt="missing"></p>
		<p><img src="Assets/%E0%A4%A.png" alt="malformed"></p>
		<p><img src="Assets/vector.svg" alt="unsupported"></p>
	</article></body></html>`);
	zip.file('Assets/photo one.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	zip.file('Assets/caption.jpg', new Uint8Array([0xff, 0xd8, 0xff]));
	zip.file('Assets/list.gif', new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
	zip.file('Assets/table.webp', new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]));
	zip.file('Assets/vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>');

	const bytes = await zip.generateAsync({ type: 'uint8array' });
	const archive = new File([bytes], 'notion-regression.zip', { type: 'application/zip' });

	const preview = await importer.previewNotionHtmlImport(archive);
	assert.equal(preview.pageCount, 1);
	assert.equal(preview.imageCount, 7, 'preview should count all represented image placements');
	assert.equal(preview.remoteImageCount, 1);
	assert.equal(preview.skippedImageCount, 3);
	assert.ok(preview.warnings.some((warning) => warning.includes('Could not find')));
	assert.ok(preview.warnings.some((warning) => warning.includes('malformed percent-encoding')));
	assert.ok(preview.warnings.some((warning) => warning.includes('unsupported')));

	const result = await importer.applyNotionHtmlImport(archive);
	assert.equal(result.imageCount, 7);
	assert.equal(result.remoteImageCount, 1);
	assert.equal(result.skippedImageCount, 3);

	const descendants = (await pagesModule.getActivePages()).filter((page) => page.id !== result.rootPageId);
	const importedPage = descendants.find((page) => page.title === 'Page');
	assert.ok(importedPage, 'the imported page should exist');
	const document = JSON.parse(importedPage.contentJson);
	const imageNodes = [];
	const collectImages = (node, target = imageNodes) => {
		if (!node || typeof node !== 'object') return;
		if (node.type === 'image') target.push(node);
		for (const child of node.content || []) collectImages(child, target);
	};
	collectImages(document);
	assert.equal(imageNodes.length, 7, 'all importable image placements should survive conversion');
	assert.ok(imageNodes.some((node) => node.attrs?.alt === 'heading'), 'heading image should be preserved');
	assert.ok(imageNodes.some((node) => node.attrs?.alt === 'toggle'), 'toggle summary image should be preserved');
	assert.ok(preview.warnings.some((warning) => warning.includes('headings')));
	assert.ok(preview.warnings.some((warning) => warning.includes('toggle summaries')));
	assert.equal(sqlite.prepare('select count(*) as count from assets').get().count, 4, 'only local images should create assets');

	const standaloneHtml = `<!doctype html><html><head><title>Standalone HTML</title></head><body><article>
		<h1>Standalone HTML</h1>
		<p><img src="data:image/png;base64,iVBORw0KGgo=" alt="embedded"></p>
		<p><img src="images/not-included.png" alt="missing"></p>
	</article></body></html>`;
	const htmlFile = new File([standaloneHtml], 'standalone.html', { type: 'text/html' });
	const htmlPreview = await importer.previewNotionHtmlImport(htmlFile);
	assert.equal(htmlPreview.pageCount, 1);
	assert.equal(htmlPreview.imageCount, 1, 'standalone HTML should import embedded images');
	assert.equal(htmlPreview.skippedImageCount, 1, 'standalone HTML should report missing relative images');

	const htmlResult = await importer.applyNotionHtmlImport(htmlFile);
	assert.equal(htmlResult.imageCount, 1);
	assert.equal(htmlResult.skippedImageCount, 1);
	const standalonePage = (await pagesModule.getActivePages()).find((page) => page.title === 'Standalone HTML');
	assert.ok(standalonePage, 'the standalone HTML page should exist');
	const standaloneDocument = JSON.parse(standalonePage.contentJson);
	const standaloneImages = [];
	collectImages(standaloneDocument, standaloneImages);
	assert.equal(standaloneImages.length, 1);
	assert.equal(sqlite.prepare('select count(*) as count from assets').get().count, 5, 'embedded HTML images should create assets');

	const csvFile = new File(['Name,Status,Estimate\nTask A,Done,3\nTask B,Todo,5\n'], 'Tasks.csv', { type: 'text/csv' });
	const csvPreview = await importer.previewNotionHtmlImport(csvFile);
	assert.equal(csvPreview.pageCount, 1);
	assert.equal(csvPreview.databaseCount, 1);
	await importer.applyNotionHtmlImport(csvFile);
	const csvPage = (await pagesModule.getActivePages()).find((page) => page.title === 'Tasks');
	assert.ok(csvPage, 'the imported CSV database page should exist');
	const csvDocument = JSON.parse(csvPage.contentJson);
	assert.equal(csvDocument.content[0].type, 'databaseBlock');
	assert.equal(csvDocument.content[0].attrs.columns[1].type, 'status');

	const markdownFile = new File(['# Projects\n\n| Name | Status |\n| --- | --- |\n| Alpha | Done |\n'], 'Projects.md', { type: 'text/markdown' });
	const markdownPreview = await importer.previewNotionHtmlImport(markdownFile);
	assert.equal(markdownPreview.databaseCount, 1);
	await importer.applyNotionHtmlImport(markdownFile);
	const markdownPage = (await pagesModule.getActivePages()).find((page) => page.title === 'Projects');
	assert.ok(markdownPage, 'the imported Markdown page should exist');
	const markdownDocument = JSON.parse(markdownPage.contentJson);
	assert.equal(markdownDocument.content[0].type, 'databaseBlock');

	console.log('Notion image import regression checks passed');
} finally {
	if (sqlite && sqlite.open) sqlite.close();
	if (vite) await vite.close();
	await rm(temporaryRoot, { recursive: true, force: true });
}
