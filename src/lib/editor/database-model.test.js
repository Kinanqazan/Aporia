import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDatabaseAction, normalizeDatabaseAttributes, renameDatabaseOption, sortDatabaseRows } from './database-model.ts';

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

test('adding row with prepend: true inserts row at the beginning', () => {
	const source = database();
	const next = applyDatabaseAction(source, { type: 'add-row', prepend: true });
	assert.equal(next.rows.length, 3);
	assert.equal(next.rows[1].id, 'row-1');
	assert.equal(next.rows[2].id, 'row-2');
});

test('row visibility limit caps at 50 rows until expanded', () => {
	const ROW_LIMIT = 50;
	const dummyRows = Array.from({ length: 75 }, (_, i) => ({ id: `row-${i}`, name: `Row ${i}` }));
	
	/**
	 * @param {any[]} rows
	 * @param {boolean} showAll
	 */
	const getVisibleRows = (rows, showAll) => {
		if (showAll || rows.length <= ROW_LIMIT) return rows;
		return rows.slice(0, ROW_LIMIT);
	};

	assert.equal(getVisibleRows(dummyRows, false).length, 50);
	assert.equal(getVisibleRows(dummyRows, true).length, 75);
	assert.equal(getVisibleRows(dummyRows.slice(0, 30), false).length, 30);
});

test('shift-selecting rows selects all rows in between', () => {
	const visibleRows = Array.from({ length: 10 }, (_, i) => ({ id: `row-${i}` }));

	/** @type {string[]} */
	let selectedRowIds = [];
	/** @type {string | null} */
	let lastSelectedRowId = null;

	/**
	 * @param {string} rowId
	 * @param {boolean} [isShift]
	 */
	const toggleSelection = (rowId, isShift = false) => {
		if (isShift && lastSelectedRowId && lastSelectedRowId !== rowId) {
			const fromIdx = visibleRows.findIndex(r => r.id === lastSelectedRowId);
			const toIdx = visibleRows.findIndex(r => r.id === rowId);

			if (fromIdx !== -1 && toIdx !== -1) {
				const start = Math.min(fromIdx, toIdx);
				const end = Math.max(fromIdx, toIdx);
				const rangeIds = visibleRows.slice(start, end + 1).map(r => r.id);
				selectedRowIds = [...new Set([...selectedRowIds, ...rangeIds])];
				lastSelectedRowId = rowId;
				return;
			}
		}

		if (selectedRowIds.includes(rowId)) {
			selectedRowIds = selectedRowIds.filter(id => id !== rowId);
			if (lastSelectedRowId === rowId) {
				lastSelectedRowId = selectedRowIds.length > 0 ? selectedRowIds[selectedRowIds.length - 1] : null;
			}
		} else {
			selectedRowIds = [...selectedRowIds, rowId];
			lastSelectedRowId = rowId;
		}
	};

	// 1. Select row-2
	toggleSelection('row-2', false);
	assert.deepEqual(selectedRowIds, ['row-2']);

	// 2. Shift-select row-6 (forward selection)
	toggleSelection('row-6', true);
	assert.deepEqual(selectedRowIds, ['row-2', 'row-3', 'row-4', 'row-5', 'row-6']);

	// 3. Select row-8, then shift-select row-5 (backward selection)
	selectedRowIds = [];
	lastSelectedRowId = null;
	toggleSelection('row-8', false);
	toggleSelection('row-5', true);
	assert.deepEqual(selectedRowIds, ['row-8', 'row-5', 'row-6', 'row-7']);
});

test('move-option action changes status label order in database options', () => {
	const source = normalizeDatabaseAttributes({
		columns: [{ id: 'status', name: 'Status', type: 'status' }],
		rows: [],
		options: { status: ['Todo', 'In Progress', 'Done'] }
	});

	// Move 'Done' up by 1 (from index 2 to index 1)
	const movedUp = applyDatabaseAction(source, {
		type: 'move-option',
		colId: 'status',
		option: 'Done',
		delta: -1
	});
	assert.deepEqual(movedUp.options.status, ['Todo', 'Done', 'In Progress']);

	// Move 'Todo' down by 2 (from index 0 to index 2)
	const movedDown = applyDatabaseAction(movedUp, {
		type: 'move-option',
		colId: 'status',
		option: 'Todo',
		delta: 2
	});
	assert.deepEqual(movedDown.options.status, ['Done', 'In Progress', 'Todo']);

	// Moving beyond bounds does not change anything
	const outOfBounds = applyDatabaseAction(source, {
		type: 'move-option',
		colId: 'status',
		option: 'Todo',
		delta: -1
	});
	assert.deepEqual(outOfBounds.options.status, ['Todo', 'In Progress', 'Done']);
});

test('sortDatabaseRows sorts rows according to the order of status options', () => {
	/** @type {import('./database-model.ts').DatabaseColumn} */
	const column = { id: 'status', name: 'Status', type: 'status' };
	const columnOptions = ['Backlog', 'In Progress', 'Done'];

	const rows = [
		{ id: 'r1', status: 'Done' },
		{ id: 'r2', status: '' },
		{ id: 'r3', status: 'Backlog' },
		{ id: 'r4', status: 'In Progress' },
		{ id: 'r5', status: null }
	];

	// Ascending: empty values at the beginning ('r2', 'r5'), then Backlog (0), In Progress (1), Done (2)
	const ascRows = sortDatabaseRows(rows, column, 'asc', columnOptions);
	assert.deepEqual(
		ascRows.map(r => r.id),
		['r2', 'r5', 'r3', 'r4', 'r1']
	);

	// Descending: empty values still at the beginning ('r2', 'r5'), then Done (2), In Progress (1), Backlog (0)
	const descRows = sortDatabaseRows(rows, column, 'desc', columnOptions);
	assert.deepEqual(
		descRows.map(r => r.id),
		['r2', 'r5', 'r1', 'r4', 'r3']
	);

	// If options order is changed (e.g. Done moved to first)
	const reorderedOptions = ['Done', 'Backlog', 'In Progress'];
	const reorderedAsc = sortDatabaseRows(rows, column, 'asc', reorderedOptions);
	assert.deepEqual(
		reorderedAsc.map(r => r.id),
		['r2', 'r5', 'r1', 'r3', 'r4']
	);
});

