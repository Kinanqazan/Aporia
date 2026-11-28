import assert from 'node:assert/strict';
import test from 'node:test';
import { validateEditorDocument, validateTodoPageChange } from './document.ts';

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

test('supports poetry, dividers, and dedicated to-do page rules', () => {
	const rich = { type: 'doc', content: [{ type: 'poetry', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A line' }] }] }, { type: 'horizontalRule' }] };
	assert.equal(validateEditorDocument(rich), null);
	const todo = { type: 'doc', content: [{ type: 'taskList', attrs: { pageControls: true }, content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph' }] }] }] };
	assert.equal(validateEditorDocument(todo), null);
	assert.equal(validateTodoPageChange(null, todo), null);
	assert.equal(validateTodoPageChange(todo, { type: 'doc', content: [...todo.content, { type: 'horizontalRule' }] }) !== null, true);
	assert.equal(validateTodoPageChange(todo, rich) !== null, true);
});

test('rejects unsupported nodes, attributes, and invalid child structure', () => {
	assert.match(validateEditorDocument({ type: 'doc', content: [{ type: 'futureBlock' }] }) ?? '', /Unknown document node/);
	assert.match(validateEditorDocument({ type: 'doc', attrs: { lostData: true } }) ?? '', /Unknown attribute/);
	assert.notEqual(validateEditorDocument({ type: 'doc', content: [{ type: 'text', text: 'orphan' }] }), null);
});
