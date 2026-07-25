import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDatabaseAction, normalizeDatabaseAttributes, renameDatabaseOption } from './database-model.ts';

const database = () => normalizeDatabaseAttributes({
	columns: [
		{ id: 'name', name: 'Name', type: 'text' },
		{ id: 'status', name: 'Status', type: 'status' }
	],
	rows: [
		{ id: 'row-1', name: 'One', status: 'Todo' },
		{ id: 'row-2', name: 'Two', status: 'Done' }
	],
	options: { status: ['Todo', 'Done'] }
});

test('database row actions target only the requested row', () => {
	const next = applyDatabaseAction(database(), { type: 'delete-row', rowId: 'row-1' });
	assert.deepEqual(next.rows.map(row => row.id), ['row-2']);
});

test('database action results do not mutate the source', () => {
	const source = database();
	const next = applyDatabaseAction(source, {
		type: 'set-option', rowId: 'row-1', colId: 'status', option: 'Done', multi: false
	});
	assert.equal(source.rows[0].status, 'Todo');
	assert.equal(next.rows[0].status, 'Done');
});

test('deleting the final column is rejected', () => {
	const source = normalizeDatabaseAttributes({ columns: [{ id: 'only', name: 'Only', type: 'text' }], rows: [{ id: 'row', only: 'value' }] });
	const next = applyDatabaseAction(source, { type: 'delete-column', colId: 'only' });
	assert.equal(next.columns.length, 1);
});

test('duplicating rows deep-clones multi-select values', () => {
	const source = normalizeDatabaseAttributes({
		columns: [{ id: 'tags', name: 'Tags', type: 'multi-select' }],
		rows: [{ id: 'row', tags: ['A'] }]
	});
	const next = applyDatabaseAction(source, { type: 'duplicate-rows', rowIds: ['row'] });
	assert.equal(next.rows.length, 2);
	assert.notEqual(next.rows[0].tags, next.rows[1].tags);
});

test('saved sorting and summary settings normalize correctly', () => {
	const source = normalizeDatabaseAttributes({
		columns: [
			{ id: 'amount', name: 'Amount', type: 'number' },
			{ id: 'name', name: 'Name', type: 'text' }
		],
		rows: [{ id: 'row', amount: 4, name: 'One' }],
		showSummary: true,
		summary: { amount: 'max' },
		sort: { columnId: 'amount', direction: 'desc' }
	});
	assert.equal(source.showSummary, true);
	assert.equal(source.summary?.amount, 'max');
	assert.deepEqual(source.sort, { columnId: 'amount', direction: 'desc' });
	assert.equal(applyDatabaseAction(source, { type: 'delete-column', colId: 'amount' }).sort, null);
});

test('renaming a select option updates existing row values', () => {
	const source = database();
	const next = renameDatabaseOption(source, 'status', 'Todo', 'Ready');
	assert.deepEqual(next?.options.status, ['Ready', 'Done']);
	assert.equal(next?.rows[0].status, 'Ready');
	assert.equal(renameDatabaseOption(source, 'status', 'Todo', 'Done'), null);
});
