export type DatabaseColumnType = 'text' | 'number' | 'date' | 'status' | 'multi-select';

export interface DatabaseColumn {
	id: string;
	name: string;
	type: DatabaseColumnType;
	width?: number;
}

export type DatabaseCellValue = string | number | string[] | null | undefined;
export type DatabaseSummaryMode = 'sum' | 'min' | 'max';
export interface DatabaseSort {
	columnId: string;
	direction: 'asc' | 'desc';
}

export interface DatabaseRow {
	id: string;
	[key: string]: DatabaseCellValue;
}

export type DatabaseOptions = Record<string, string[]>;

export interface DatabaseAttributes {
	columns: DatabaseColumn[];
	rows: DatabaseRow[];
	options: DatabaseOptions;
	showSummary?: boolean;
	summary?: Record<string, DatabaseSummaryMode>;
	sort?: DatabaseSort | null;
}

export type DatabaseAction =
	| { type: 'update-cell'; rowId: string; colId: string; value: DatabaseCellValue }
	| { type: 'add-row'; afterRowId?: string | null }
	| { type: 'insert-row-above'; rowId: string }
	| { type: 'delete-row'; rowId: string }
	| { type: 'duplicate-rows'; rowIds: string[] }
	| { type: 'delete-rows'; rowIds: string[] }
	| { type: 'add-column'; afterColumnId?: string | null }
	| { type: 'delete-column'; colId: string }
	| { type: 'insert-column-left'; colId: string }
	| { type: 'insert-column-right'; colId: string }
	| { type: 'rename-column'; colId: string; name: string }
	| { type: 'change-column-type'; colId: string; columnType: DatabaseColumnType }
	| { type: 'resize-column'; colId: string; width: number }
	| { type: 'add-option'; colId: string; option: string }
	| { type: 'remove-option'; colId: string; option: string }
	| { type: 'set-option'; rowId: string; colId: string; option: string; multi: boolean };

export function generateDatabaseId(prefix = 'id'): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return `${prefix}-${crypto.randomUUID()}`;
	}
	return `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function cloneRow(row: DatabaseRow, id = row.id): DatabaseRow {
	const clone: DatabaseRow = { ...row, id };
	for (const [key, value] of Object.entries(clone)) {
		if (Array.isArray(value)) clone[key] = [...value];
	}
	return clone;
}

function initialValue(column: DatabaseColumn): DatabaseCellValue {
	return column.type === 'multi-select' ? [] : '';
}

function createRow(columns: DatabaseColumn[]): DatabaseRow {
	const row: DatabaseRow = { id: generateDatabaseId('row') };
	for (const column of columns) row[column.id] = initialValue(column);
	return row;
}

function convertValue(value: DatabaseCellValue, type: DatabaseColumnType): DatabaseCellValue {
	if (type === 'multi-select') return Array.isArray(value) ? [...value] : value ? [String(value)] : [];
	if (type === 'status') return Array.isArray(value) ? String(value[0] ?? '') : value == null ? '' : String(value);
	if (type === 'number') {
		if (value === '' || value == null) return '';
		const number = Number(value);
		return Number.isFinite(number) ? number : '';
	}
	if (Array.isArray(value)) return value[0] ?? '';
	return value ?? '';
}

export function normalizeDatabaseAttributes(input: Partial<DatabaseAttributes> | null | undefined): DatabaseAttributes {
	const columns = Array.isArray(input?.columns)
		? input.columns
			.filter(Boolean)
			.map((column: any, index) => ({
				id: String(column.id || generateDatabaseId(`column-${index}`)),
				name: String(column.name || 'Untitled'),
				type: (['text', 'number', 'date', 'status', 'multi-select'] as const).includes(column.type)
					? column.type
					: 'text',
				...(Number.isFinite(Number(column.width)) ? { width: Math.max(90, Number(column.width)) } : {})
			}))
		: [];

	const rows = Array.isArray(input?.rows)
		? input.rows.filter(Boolean).map((row: any, index) => ({
				...row,
				id: String(row.id || generateDatabaseId(`row-${index}`))
			}))
		: [];

	const options: DatabaseOptions = {};
	if (input?.options && typeof input.options === 'object') {
		for (const [columnId, values] of Object.entries(input.options)) {
			options[columnId] = Array.isArray(values)
				? values.map(String).filter((value, index, all) => value.trim() && all.indexOf(value) === index)
				: [];
		}
	}

	const summary: Record<string, DatabaseSummaryMode> = {};
	if (input?.summary && typeof input.summary === 'object') {
		for (const [columnId, mode] of Object.entries(input.summary)) {
			if (mode === 'sum' || mode === 'min' || mode === 'max') summary[columnId] = mode;
		}
	}

	const sort = input?.sort && typeof input.sort === 'object'
		&& typeof input.sort.columnId === 'string'
		&& (input.sort.direction === 'asc' || input.sort.direction === 'desc')
		? { columnId: input.sort.columnId, direction: input.sort.direction }
		: null;

	return { columns, rows, options, showSummary: input?.showSummary === true, summary, sort };
}

export function renameDatabaseOption(
	input: DatabaseAttributes,
	colId: string,
	optionToRename: string,
	nextName: string
): DatabaseAttributes | null {
	const database = normalizeDatabaseAttributes(input);
	const trimmedName = nextName.trim();
	const currentOptions = database.options[colId] || [];
	if (!trimmedName || trimmedName === optionToRename || currentOptions.includes(trimmedName)) return null;

	const column = database.columns.find((item) => item.id === colId);
	const rows = database.rows.map((row) => {
		const value = row[colId];
		if (column?.type === 'multi-select' && Array.isArray(value)) {
			return { ...row, [colId]: value.map((option) => option === optionToRename ? trimmedName : option) };
		}
		return value === optionToRename ? { ...row, [colId]: trimmedName } : row;
	});

	return {
		...database,
		options: {
			...database.options,
			[colId]: currentOptions.map((option) => option === optionToRename ? trimmedName : option)
		},
		rows
	};
}

export function applyDatabaseAction(input: DatabaseAttributes, action: DatabaseAction): DatabaseAttributes {
	const database = normalizeDatabaseAttributes(input);
	const { columns, rows, options } = database;

	switch (action.type) {
		case 'update-cell':
			return { ...database, rows: rows.map(row => row.id === action.rowId ? { ...row, [action.colId]: action.value } : row) };
		case 'add-row': {
			const row = createRow(columns);
			if (!action.afterRowId) return { ...database, rows: [...rows, row] };
			const index = rows.findIndex(item => item.id === action.afterRowId);
			if (index < 0) return database;
			const nextRows = [...rows];
			nextRows.splice(index + 1, 0, row);
			return { ...database, rows: nextRows };
		}
		case 'insert-row-above': {
			const index = rows.findIndex(row => row.id === action.rowId);
			if (index < 0) return database;
			const nextRows = [...rows];
			nextRows.splice(index, 0, createRow(columns));
			return { ...database, rows: nextRows };
		}
		case 'delete-row':
			return { ...database, rows: rows.filter(row => row.id !== action.rowId) };
		case 'delete-rows': {
			const ids = new Set(action.rowIds);
			return { ...database, rows: rows.filter(row => !ids.has(row.id)) };
		}
		case 'duplicate-rows': {
			const ids = new Set(action.rowIds);
			const nextRows: DatabaseRow[] = [];
			for (const row of rows) {
				nextRows.push(row);
				if (ids.has(row.id)) nextRows.push(cloneRow(row, generateDatabaseId('row')));
			}
			return { ...database, rows: nextRows };
		}
		case 'add-column': {
			const column: DatabaseColumn = { id: generateDatabaseId('column'), name: 'New Column', type: 'text' };
			const index = action.afterColumnId ? columns.findIndex(item => item.id === action.afterColumnId) : columns.length - 1;
			const nextColumns = [...columns];
			nextColumns.splice(Math.max(0, index + 1), 0, column);
			return { ...database, columns: nextColumns, rows: rows.map(row => ({ ...row, [column.id]: '' })) };
		}
		case 'delete-column':
			if (columns.length <= 1) return database;
			return {
				...database,
				columns: columns.filter(column => column.id !== action.colId),
				rows: rows.map(row => { const next = { ...row }; delete next[action.colId]; return next; }),
				options: Object.fromEntries(Object.entries(options).filter(([id]) => id !== action.colId)),
				summary: Object.fromEntries(Object.entries(database.summary || {}).filter(([id]) => id !== action.colId)),
				sort: database.sort?.columnId === action.colId ? null : database.sort
			};
		case 'insert-column-left':
		case 'insert-column-right': {
			const index = columns.findIndex(column => column.id === action.colId);
			if (index < 0) return database;
			const column: DatabaseColumn = { id: generateDatabaseId('column'), name: 'New Column', type: 'text' };
			const nextColumns = [...columns];
			nextColumns.splice(index + (action.type === 'insert-column-right' ? 1 : 0), 0, column);
			return { ...database, columns: nextColumns, rows: rows.map(row => ({ ...row, [column.id]: '' })) };
		}
		case 'rename-column':
			return { ...database, columns: columns.map(column => column.id === action.colId ? { ...column, name: action.name } : column) };
		case 'change-column-type': {
			const column = columns.find(item => item.id === action.colId);
			if (!column) return database;
			const nextOptions = { ...options };
			if ((action.columnType === 'status' || action.columnType === 'multi-select') && !nextOptions[action.colId]) {
				nextOptions[action.colId] = ['Todo', 'In Progress', 'Done'];
			}
			return {
				...database,
				columns: columns.map(item => item.id === action.colId ? { ...item, type: action.columnType } : item),
				rows: rows.map(row => ({ ...row, [action.colId]: convertValue(row[action.colId], action.columnType) })),
				options: nextOptions
			};
		}
		case 'resize-column':
			return { ...database, columns: columns.map(column => column.id === action.colId ? { ...column, width: Math.max(90, Math.round(action.width)) } : column) };
		case 'add-option': {
			const option = action.option.trim();
			if (!option) return database;
			const current = options[action.colId] || [];
			return current.includes(option) ? database : { ...database, options: { ...options, [action.colId]: [...current, option] } };
		}
		case 'remove-option': {
			const nextRows = rows.map(row => {
				const value = row[action.colId];
				return Array.isArray(value)
					? { ...row, [action.colId]: value.filter(item => item !== action.option) }
					: value === action.option ? { ...row, [action.colId]: '' } : row;
			});
			return { ...database, rows: nextRows, options: { ...options, [action.colId]: (options[action.colId] || []).filter(option => option !== action.option) } };
		}
		case 'set-option': {
			const row = rows.find(item => item.id === action.rowId);
			if (!row) return database;
			const current = row[action.colId];
			const next = action.multi
				? (Array.isArray(current) ? current : []).includes(action.option)
					? (Array.isArray(current) ? current : []).filter(value => value !== action.option)
					: [...(Array.isArray(current) ? current : []), action.option]
				: current === action.option ? '' : action.option;
			return { ...database, rows: rows.map(item => item.id === action.rowId ? { ...item, [action.colId]: next } : item) };
		}
	}
}
