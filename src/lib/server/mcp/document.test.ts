import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEditorDocument } from './document.ts';

test('accepts rich editor structures without converting them', () => {
	const document = { type: 'doc', content: [
		{ type: 'details', attrs: { open: false, level: 2 }, content: [
			{ type: 'detailsSummary', content: [{ type: 'text', text: 'Toggle' }] },
			{ type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }] }
		] },
		{ type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false, order: 2 }, content: [{ type: 'paragraph' }] }] },
		{ type: 'table', content: [{ type: 'tableRow', content: [
			{ type: 'tableHeader', content: [{ type: 'paragraph' }] },
			{ type: 'tableCell', content: [{ type: 'paragraph' }] }
		] }] },
		{ type: 'image', attrs: { src: 'https://example.test/image.png', alt: 'photo', title: null, width: 300, height: 200, source: 'remote', assetId: null } },
		{ type: 'columnLayout', content: [
			{ type: 'column', attrs: { width: '50' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept', marks: [{ type: 'textStyle', attrs: { color: '#123456' } }] }] }] },
			{ type: 'column', content: [{ type: 'databaseBlock', attrs: { columns: [], rows: [], options: {}, showSummary: false, summary: {}, sort: null } }] }
		] }
	] };
	assert.equal(validateEditorDocument(document), null);
});

test('rejects unsupported nodes, attributes, and invalid child structure', () => {
	assert.match(validateEditorDocument({ type: 'doc', content: [{ type: 'futureBlock' }] }) ?? '', /Unknown document node/);
	assert.match(validateEditorDocument({ type: 'doc', attrs: { lostData: true } }) ?? '', /Unknown attribute/);
	assert.notEqual(validateEditorDocument({ type: 'doc', content: [{ type: 'text', text: 'orphan' }] }), null);
});
