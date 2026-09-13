<script lang="ts">
	import { 
		Plus, Trash2, ArrowUp, ArrowDown, ArrowUpDown, ArrowLeft, ArrowRight,
		Settings, Search, Calendar, Hash, Type, CheckSquare, 
		ChevronDown, ChevronUp, PlusCircle, X, Copy, Filter
	} from 'lucide-svelte';
	import { generateDatabaseId, renameDatabaseOption } from '$lib/editor/database-model';

	let { tiptapNode, updateAttributes, editable: propEditable } = $props();

	// Live reactive state for editable reading live ProseMirror editor/view state
	let editable = $derived(propEditable !== undefined ? propEditable : (tiptapNode?.editable ?? true));

	// Reactive bindings to tip-tap state
	let columns = $derived(tiptapNode.node.attrs.columns || []);
	let rows = $derived(tiptapNode.node.attrs.rows || []);
	let options = $derived(tiptapNode.node.attrs.options || {});
	let showSummary = $derived(tiptapNode.node.attrs.showSummary === true);
	let summary = $derived(tiptapNode.node.attrs.summary || {});

	// Local UI states
	const ROW_LIMIT = 50;
	let showAllRows = $state(false);
	let searchQuery = $state('');
	let isFilterOpen = $state(false);
	let filterColumnId = $state('');
	let filterValue = $state('');
	let activeFilterColumn = $derived(columns.find((column: any) => column.id === filterColumnId));
	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<'asc' | 'desc' | null>(null);
	let sortInitialized = $state(false);
	let selectedRowIds = $state<string[]>([]);
	let hoveredRowId = $state<string | null>(null);
	
	// Popovers & Resizing
	let activeColumnMenu = $state<string | null>(null); // columnId
	let activeSelectDropdown = $state<{ rowId: string; colId: string } | null>(null);
	let isResizing = $state(false);
	let resizingColId = $state<string | null>(null);
	let previewColumnWidth = $state<{ colId: string; width: number } | null>(null);

	// Multi-row Selection & Bulk Actions
	let lastSelectedRowId = $state<string | null>(null);

	function toggleRowSelection(rowId: string, isShift = false) {
		const visible = visibleRows();
		if (isShift && lastSelectedRowId && lastSelectedRowId !== rowId) {
			const fromIdx = visible.findIndex((r: any) => r.id === lastSelectedRowId);
			const toIdx = visible.findIndex((r: any) => r.id === rowId);

			if (fromIdx !== -1 && toIdx !== -1) {
				const start = Math.min(fromIdx, toIdx);
				const end = Math.max(fromIdx, toIdx);
				const rangeIds = visible.slice(start, end + 1).map((r: any) => r.id);
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
	}

	function toggleSelectAll(visibleRows = rows) {
		const allIds = visibleRows.map((r: any) => r.id);
		const allSelected = allIds.length > 0 && allIds.every((id: string) => selectedRowIds.includes(id));
		if (allSelected) {
			selectedRowIds = selectedRowIds.filter(id => !allIds.includes(id));
			lastSelectedRowId = null;
		} else {
			selectedRowIds = [...new Set([...selectedRowIds, ...allIds])];
			lastSelectedRowId = null;
		}
	}


	function clearSelection() {
		selectedRowIds = [];
		lastSelectedRowId = null;
	}

	function bulkDeleteSelectedRows() {
		if (!editable || selectedRowIds.length === 0) return;
		const updatedRows = rows.filter((r: any) => !selectedRowIds.includes(r.id));
		selectedRowIds = [];
		updateAttributes({ rows: updatedRows });
	}

	function bulkDuplicateSelectedRows() {
		if (!editable || selectedRowIds.length === 0) return;
		const newRows: any[] = [];
		rows.forEach((r: any) => {
			newRows.push(r);
			if (selectedRowIds.includes(r.id)) {
				newRows.push({ ...r, id: generateId() });
			}
		});
		selectedRowIds = [];
		updateAttributes({ rows: newRows });
	}

	// Temporary edit inputs
	let newOptionText = $state('');
	let containerElement = $state<HTMLDivElement>();
	let filterWrapperElement = $state<HTMLDivElement>();

	// Precise row & checkbox alignment
	let tableElement = $state<HTMLTableElement>();
	let gutterElement = $state<HTMLDivElement>();
	let headerTop = $state<number | null>(null);
	let headerHeight = $state<number>(34);
	let rowTops = $state<number[]>([]);
	let rowHeights = $state<number[]>([]);
	let gutterHeight = $state<number | null>(null);

	function syncRowHeights() {
		if (!tableElement || !gutterElement) return;
		const gutterRect = gutterElement.getBoundingClientRect();
		const theadTr = tableElement.querySelector('thead tr');
		if (theadTr) {
			const trRect = theadTr.getBoundingClientRect();
			headerTop = Math.round((trRect.top - gutterRect.top) * 100) / 100;
			headerHeight = Math.round(trRect.height * 100) / 100;
		}

		const trs = tableElement.querySelectorAll('tbody tr');
		const nextTops: number[] = [];
		const nextHeights: number[] = [];
		for (let i = 0; i < trs.length; i++) {
			const r = trs[i].getBoundingClientRect();
			nextTops.push(Math.round((r.top - gutterRect.top) * 100) / 100);
			nextHeights.push(Math.round(r.height * 100) / 100);
		}
		rowTops = nextTops;
		rowHeights = nextHeights;
		gutterHeight = Math.round(tableElement.offsetHeight * 100) / 100;
	}

	$effect(() => {
		// Track visibleRows so any row changes (search, filter, pagination, add/delete) re-sync
		const _ = visibleRows();
		if (!editable) return;

		let rafId: number | null = null;
		rafId = requestAnimationFrame(() => {
			syncRowHeights();
		});

		let observer: ResizeObserver | null = null;
		if (tableElement && typeof ResizeObserver !== 'undefined') {
			observer = new ResizeObserver(() => {
				syncRowHeights();
			});
			observer.observe(tableElement);
		}

		const handleResize = () => syncRowHeights();
		window.addEventListener('resize', handleResize);

		return () => {
			if (rafId) cancelAnimationFrame(rafId);
			if (observer) observer.disconnect();
			window.removeEventListener('resize', handleResize);
		};
	});

	// Click outside detection & custom event listeners using standard Svelte 5 $effect
	$effect(() => {
		const handleDocumentClick = (e: MouseEvent) => {
			const target = e.target as Node;

			if (filterWrapperElement && !filterWrapperElement.contains(target)) {
				isFilterOpen = false;
			}

			if (containerElement && !containerElement.contains(target)) {
				activeColumnMenu = null;
				activeSelectDropdown = null;
			} else if (target instanceof HTMLElement) {
				const isPopoverClick = target.closest('.th-menu-popover, .th-menu-trigger, .tag-select-popover, .tag-trigger-btn');
				if (!isPopoverClick) {
					activeColumnMenu = null;
					activeSelectDropdown = null;
				}
			}
		};
		document.addEventListener('click', handleDocumentClick);

		return () => {
			document.removeEventListener('click', handleDocumentClick);
		};
	});

	$effect(() => {
		const validIds = new Set(rows.map((row: any) => row.id));
		const nextSelectedRowIds = selectedRowIds.filter(id => validIds.has(id));
		if (nextSelectedRowIds.length !== selectedRowIds.length) {
			selectedRowIds = nextSelectedRowIds;
		}
		if (lastSelectedRowId && !validIds.has(lastSelectedRowId)) {
			lastSelectedRowId = null;
		}
	});

	$effect(() => {
		if (!editable) {
			if (activeColumnMenu !== null) activeColumnMenu = null;
			if (activeSelectDropdown !== null) activeSelectDropdown = null;
			if (isResizing) cancelResize();
		}
	});

	$effect(() => {
		const persistedSort = tiptapNode.node.attrs.sort;
		if (!editable && sortInitialized) return;
		const nextColumn = persistedSort?.columnId ?? null;
		const nextDirection = persistedSort?.direction === 'asc' || persistedSort?.direction === 'desc'
			? persistedSort.direction
			: null;
		if (sortColumn !== nextColumn) sortColumn = nextColumn;
		if (sortDirection !== nextDirection) sortDirection = nextDirection;
		sortInitialized = true;
	});

	// Generate a unique ID
	function generateId() {
		return generateDatabaseId('id');
	}

	function getColumnWidth(column: any): string {
		const preview = previewColumnWidth;
		const width = preview && preview.colId === column.id ? preview.width : column.width;
		return `${width || 180}px`;
	}

	function clearFilter() {
		filterColumnId = '';
		filterValue = '';
	}

	function toggleSummary() {
		if (!editable) return;
		updateAttributes({ showSummary: !showSummary });
	}

	function getSummaryMode(colId: string): 'sum' | 'min' | 'max' {
		const mode = summary[colId];
		return mode === 'min' || mode === 'max' ? mode : 'sum';
	}

	function updateSummaryMode(colId: string, mode: string) {
		if (!editable || !['sum', 'min', 'max'].includes(mode)) return;
		updateAttributes({ summary: { ...summary, [colId]: mode } });
	}

	function summaryLabel(mode: 'sum' | 'min' | 'max') {
		return mode === 'min' ? 'Min' : mode === 'max' ? 'Max' : 'Sum';
	}

	function getSummaryValue(colId: string, mode: 'sum' | 'min' | 'max', source = processedRows()) {
		const values = source
			.map((row: any) => row[colId])
			.filter((value: any) => value !== '' && value !== null && value !== undefined)
			.map((value: any) => Number(value))
			.filter((value: number) => Number.isFinite(value));
		if (!values.length) return '—';
		if (mode === 'min') return Math.min(...values);
		if (mode === 'max') return Math.max(...values);
		return values.reduce((total: number, value: number) => total + value, 0);
	}

	// Svelte 5 derived state for sorting and filtering
	let processedRows = $derived(() => {
		let result = [...rows];

		// Apply search filter
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase().trim();
			result = result.filter((row: any) => {
				return columns.some((col: any) => {
					const val = row[col.id];
					if (val === undefined || val === null) return false;
					if (Array.isArray(val)) {
						return val.some((v: any) => String(v).toLowerCase().includes(query));
					}
					return String(val).toLowerCase().includes(query);
				});
			});
		}

		// Apply the optional column filter after the global search filter.
		const filterColumn = columns.find((column: any) => column.id === filterColumnId);
		const normalizedFilterValue = filterValue.trim().toLowerCase();
		if (filterColumn && normalizedFilterValue.length > 0) {
			result = result.filter((row: any) => {
				const value = row[filterColumn.id];
				if (filterColumn.type === 'number') return Number(value) === Number(filterValue);
				if (filterColumn.type === 'date' || filterColumn.type === 'status') {
					return String(value ?? '').toLowerCase() === normalizedFilterValue;
				}
				if (filterColumn.type === 'multi-select') {
					return Array.isArray(value) && value.some((option: any) => String(option).toLowerCase() === normalizedFilterValue);
				}
				return String(value ?? '').toLowerCase().includes(normalizedFilterValue);
			});
		}

		// Apply sorting
		if (sortColumn && sortDirection) {
			const col = columns.find((c: any) => c.id === sortColumn);
			const isNum = col?.type === 'number';
			const isStatusOrSelect = col?.type === 'status' || col?.type === 'multi-select';
			const colOptions = options[sortColumn as string] || [];
			
			result.sort((a: any, b: any) => {
				let valA = a[sortColumn as string];
				let valB = b[sortColumn as string];

				if (valA === undefined || valA === null) valA = '';
				if (valB === undefined || valB === null) valB = '';

				if (isNum) {
					const numA = Number(valA) || 0;
					const numB = Number(valB) || 0;
					return sortDirection === 'asc' ? numA - numB : numB - numA;
				}

				if (isStatusOrSelect) {
					const getRank = (val: any) => {
						if (!val || (Array.isArray(val) && val.length === 0)) return -1;
						const target = Array.isArray(val) ? val[0] : String(val);
						const idx = colOptions.indexOf(target);
						return idx !== -1 ? idx : 999999;
					};

					const rankA = getRank(valA);
					const rankB = getRank(valB);

					// Rows with no status assigned appear at the beginning
					if (rankA === -1 && rankB === -1) return 0;
					if (rankA === -1) return -1;
					if (rankB === -1) return 1;

					return sortDirection === 'asc' ? rankA - rankB : rankB - rankA;
				}

				const strA = String(valA).toLowerCase();
				const strB = String(valB).toLowerCase();
				if (strA < strB) return sortDirection === 'asc' ? -1 : 1;
				if (strA > strB) return sortDirection === 'asc' ? 1 : -1;
				return 0;
			});
		}

		return result;
	});

	// Svelte 5 derived state for visible rows capped at ROW_LIMIT
	let visibleRows = $derived(() => {
		const all = processedRows();
		if (showAllRows || all.length <= ROW_LIMIT) {
			return all;
		}
		return all.slice(0, ROW_LIMIT);
	});

	// Row Actions
	function addRow() {
		if (!editable) return;
		const newRow = {
			id: generateId(),
			...Object.fromEntries(columns.map((column: any) => [column.id, column.type === 'multi-select' ? [] : '']))
		};
		if (searchQuery.trim()) searchQuery = '';
		if (filterValue.trim()) clearFilter();
		updateAttributes({ rows: [newRow, ...rows] });
	}

	// Column Actions
	function addColumn() {
		if (!editable) return;
		const newId = generateId();
		const updatedCols = [...columns, { id: newId, name: 'New Column', type: 'text' }];
		const updatedRows = rows.map((r: any) => ({ ...r, [newId]: '' }));
		updateAttributes({ columns: updatedCols, rows: updatedRows });
	}

	function deleteColumn(colId: string) {
		const updatedColumns = columns.filter((column: any) => column.id !== colId);
		const updatedRows = rows.map((row: any) => {
			const nextRow = { ...row };
			delete nextRow[colId];
			return nextRow;
		});
		const updatedOptions = { ...options };
		delete updatedOptions[colId];
		const updatedSummary = { ...summary };
		delete updatedSummary[colId];
		const nextSort = sortColumn === colId ? null : tiptapNode.node.attrs.sort;

		if (sortColumn === colId) {
			sortColumn = null;
			sortDirection = null;
		}
		if (filterColumnId === colId) clearFilter();
		if (activeSelectDropdown?.colId === colId) activeSelectDropdown = null;
		activeColumnMenu = null;
		updateAttributes({ columns: updatedColumns, rows: updatedRows, options: updatedOptions, summary: updatedSummary, sort: nextSort });
	}

	function moveColumn(colId: string, direction: -1 | 1) {
		if (!editable) return;
		const currentIndex = columns.findIndex((column: any) => column.id === colId);
		const targetIndex = currentIndex + direction;
		if (currentIndex < 0 || targetIndex < 0 || targetIndex >= columns.length) return;

		const updatedColumns = [...columns];
		[updatedColumns[currentIndex], updatedColumns[targetIndex]] = [updatedColumns[targetIndex], updatedColumns[currentIndex]];
		activeColumnMenu = null;
		updateAttributes({ columns: updatedColumns });
	}

	function updateColumnType(colId: string, newType: string) {
		if (!editable) return;
		activeColumnMenu = null;
		const updatedCols = columns.map((c: any) => c.id === colId ? { ...c, type: newType } : c);
		
		// If changed to status or multi-select, initialize default options if empty
		const updatedOptions = { ...options };
		if ((newType === 'status' || newType === 'multi-select') && !updatedOptions[colId]) {
			updatedOptions[colId] = ['Todo', 'In Progress', 'Done'];
		}

		// Convert row cell values appropriately
		const updatedRows = rows.map((r: any) => {
			const val = r[colId];
			if (newType === 'number') {
				const num = Number(val);
				return { ...r, [colId]: isNaN(num) ? '' : num };
			} else if (newType === 'multi-select') {
				return { ...r, [colId]: Array.isArray(val) ? val : (val ? [val] : []) };
			} else if (newType === 'status') {
				return { ...r, [colId]: Array.isArray(val) ? (val[0] || '') : String(val) };
			}
			return r;
		});

		updateAttributes({ 
			columns: updatedCols, 
			rows: updatedRows, 
			options: updatedOptions 
		});
	}

	function renameColumn(colId: string, newName: string) {
		if (!editable) return;
		const updatedCols = columns.map((c: any) => c.id === colId ? { ...c, name: newName } : c);
		updateAttributes({ columns: updatedCols });
	}

	// Column width resizing
	function startResizeColumn(colId: string, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!editable) return;

		const col = columns.find((c: any) => c.id === colId);
		const startX = e.clientX;
		const startWidth = col?.width || 180;

		isResizing = true;
		resizingColId = colId;
		previewColumnWidth = { colId, width: startWidth };

		const handleMouseMove = (moveEvent: MouseEvent) => {
			const delta = moveEvent.clientX - startX;
			const newWidth = Math.max(90, startWidth + delta);
			previewColumnWidth = { colId, width: newWidth };
		};

		const handleMouseUp = () => {
			const width = previewColumnWidth?.width;
			if (width !== undefined) {
				updateAttributes({ columns: columns.map((c: any) => c.id === colId ? { ...c, width } : c) });
			}
			isResizing = false;
			resizingColId = null;
			previewColumnWidth = null;
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
		};

		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

	function cancelResize() {
		if (!isResizing) return;
		isResizing = false;
		resizingColId = null;
		previewColumnWidth = null;
	}

	// Cell updates
	function updateCell(rowId: string, colId: string, value: any) {
		if (!editable) return;
		const updatedRows = rows.map((r: any) => r.id === rowId ? { ...r, [colId]: value } : r);
		updateAttributes({ rows: updatedRows });
	}

	// Tag/Option management
	function addOption(colId: string) {
		if (!editable || !newOptionText.trim()) return;
		const currentOptions = options[colId] || [];
		if (!currentOptions.includes(newOptionText.trim())) {
			const updatedOptions = {
				...options,
				[colId]: [...currentOptions, newOptionText.trim()]
			};
			updateAttributes({ options: updatedOptions });
		}
		newOptionText = '';
	}

	// Remove Option
	function removeOption(colId: string, optionToRemove: string) {
		if (!editable) return;
		const currentOptions = options[colId] || [];
		const updatedOptions = {
			...options,
			[colId]: currentOptions.filter((o: any) => o !== optionToRemove)
		};
		
		// Clean up rows that contain the removed option
		const col = columns.find((c: any) => c.id === colId);
		const updatedRows = rows.map((r: any) => {
			const val = r[colId];
			if (col?.type === 'multi-select' && Array.isArray(val)) {
				return { ...r, [colId]: val.filter((v: any) => v !== optionToRemove) };
			} else if (val === optionToRemove) {
				return { ...r, [colId]: '' };
			}
			return r;
		});

		updateAttributes({ 
			options: updatedOptions,
			rows: updatedRows
		});
	}

	function renameOption(colId: string, optionToRename: string, nextName: string): boolean {
		if (!editable) return false;
		const updated = renameDatabaseOption(tiptapNode.node.attrs, colId, optionToRename, nextName);
		if (!updated) return false;
		updateAttributes({ options: updated.options, rows: updated.rows });
		return true;
	}

	function moveOption(colId: string, option: string, delta: number) {
		if (!editable) return;
		const current = options[colId] || [];
		const index = current.indexOf(option);
		if (index < 0) return;
		const targetIndex = index + delta;
		if (targetIndex < 0 || targetIndex >= current.length) return;
		const next = [...current];
		const [moved] = next.splice(index, 1);
		next.splice(targetIndex, 0, moved);
		updateAttributes({ options: { ...options, [colId]: next } });
	}

	// Sorting helpers
	function toggleSort(colId: string) {
		let nextColumn: string | null = colId;
		let nextDirection: 'asc' | 'desc' | null = 'asc';
		if (sortColumn === colId) {
			if (sortDirection === 'asc') {
				nextDirection = 'desc';
			} else if (sortDirection === 'desc') {
				nextColumn = null;
				nextDirection = null;
			}
		}
		sortColumn = nextColumn;
		sortDirection = nextDirection;
		if (editable) {
			updateAttributes({ sort: nextColumn && nextDirection ? { columnId: nextColumn, direction: nextDirection } : null });
		}
	}

	// Check option selected
	function isOptionSelected(row: any, colId: string, option: string, isMulti: boolean) {
		const val = row[colId];
		if (isMulti) {
			return Array.isArray(val) && val.includes(option);
		}
		return val === option;
	}

	function toggleOptionSelection(row: any, colId: string, option: string, isMulti: boolean) {
		const val = row[colId];
		if (isMulti) {
			const current = Array.isArray(val) ? val : [];
			const next = current.includes(option)
				? current.filter((o: any) => o !== option)
				: [...current, option];
			updateCell(row.id, colId, next);
		} else {
			const next = val === option ? '' : option;
			updateCell(row.id, colId, next);
			activeSelectDropdown = null; // Close for single select
		}
	}

	// Color classes using CSS custom properties matching Notion variables in app.css
	const colorClasses = [
		{ name: 'gray', bg: 'var(--bg-gray)', text: 'var(--color-gray)' },
		{ name: 'brown', bg: 'var(--bg-brown)', text: 'var(--color-brown)' },
		{ name: 'orange', bg: 'var(--bg-orange)', text: 'var(--color-orange)' },
		{ name: 'yellow', bg: 'var(--bg-yellow)', text: 'var(--color-yellow)' },
		{ name: 'green', bg: 'var(--bg-green)', text: 'var(--color-green)' },
		{ name: 'blue', bg: 'var(--bg-blue)', text: 'var(--color-blue)' },
		{ name: 'purple', bg: 'var(--bg-purple)', text: 'var(--color-purple)' },
		{ name: 'pink', bg: 'var(--bg-pink)', text: 'var(--color-pink)' },
		{ name: 'red', bg: 'var(--bg-red)', text: 'var(--color-red)' }
	];

	function getTagColor(option: string) {
		let hash = 0;
		for (let i = 0; i < option.length; i++) {
			hash = option.charCodeAt(i) + ((hash << 5) - hash);
		}
		const idx = Math.abs(hash) % colorClasses.length;
		return colorClasses[idx];
	}
</script>

<div class="db-block-container" data-database-ui bind:this={containerElement}>
	<!-- Header controls -->
	<div class="db-header-bar">
		<div class="db-search-wrapper">
			<Search class="search-icon" size={14} />
			<input 
				type="text" 
				placeholder="Search..." 
				bind:value={searchQuery}
				onkeydown={(e) => e.stopPropagation()}
				class="db-search-input"
			/>
		</div>
		<div class="db-filter-wrapper" bind:this={filterWrapperElement}>
			<button
				type="button"
				class="db-filter-btn"
				class:active={isFilterOpen || filterColumnId !== ''}
				aria-label="Filter table"
				aria-expanded={isFilterOpen}
				onclick={(e) => { e.stopPropagation(); isFilterOpen = !isFilterOpen; activeColumnMenu = null; activeSelectDropdown = null; }}
			>
				<Filter size={14} />
				<span>Filter</span>
			</button>
			{#if isFilterOpen}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="db-filter-popover" onclick={(e) => e.stopPropagation()}>
					<div class="filter-popover-header">
						<div class="filter-title">
							<Filter size={13} class="filter-header-icon" />
							<span>Filter Rules</span>
						</div>
						{#if filterColumnId || filterValue}
							<span class="filter-badge">Active</span>
						{/if}
					</div>

					<div class="filter-field">
						<label for="database-filter-column">Column</label>
						<div class="filter-select-wrapper">
							<select id="database-filter-column" value={filterColumnId} onchange={(e) => { filterColumnId = e.currentTarget.value; filterValue = ''; }}>
								<option value="">Choose a column</option>
								{#each columns as column (column.id)}
									<option value={column.id}>{column.name}</option>
								{/each}
							</select>
							<ChevronDown size={13} class="filter-chevron" />
						</div>
					</div>

					{#if activeFilterColumn}
						<div class="filter-field">
							<label for="database-filter-value">Value</label>
							{#if activeFilterColumn.type === 'status' || activeFilterColumn.type === 'multi-select'}
								<div class="filter-select-wrapper">
									<select id="database-filter-value" bind:value={filterValue}>
										<option value="">Choose a value</option>
										{#each options[activeFilterColumn.id] || [] as option (option)}
											<option value={option}>{option}</option>
										{/each}
									</select>
									<ChevronDown size={13} class="filter-chevron" />
								</div>
							{:else}
								<input
									id="database-filter-value"
									type={activeFilterColumn.type === 'number' || activeFilterColumn.type === 'date' ? activeFilterColumn.type : 'text'}
									bind:value={filterValue}
									placeholder={activeFilterColumn.type === 'number' ? 'Enter a number...' : activeFilterColumn.type === 'date' ? 'Choose a date...' : 'Enter text...'}
									onkeydown={(e) => e.stopPropagation()}
									class="filter-input-field"
								/>
							{/if}
						</div>
					{/if}

					<div class="filter-popover-footer">
						<button type="button" class="filter-clear-btn" onclick={clearFilter} disabled={!filterColumnId && !filterValue}>
							<X size={13} /> Reset filter
						</button>
					</div>
				</div>
			{/if}
		</div>

		{#if editable}
			<button
				type="button"
				class="db-add-row-btn"
				aria-label="Add row"
				title="Add new row at the top"
				onclick={addRow}
			>
				<Plus size={14} />
				<span>New row</span>
			</button>
		{/if}

		{#if selectedRowIds.length > 0 && editable}
			<div class="db-bulk-toolbar">
				<span class="bulk-count">{selectedRowIds.length} selected</span>
				<div class="bulk-divider"></div>
				<button type="button" class="bulk-action-btn" onclick={bulkDuplicateSelectedRows} title="Duplicate Selected">
					<Copy size={13} />
					<span>Duplicate</span>
				</button>
				<button type="button" class="bulk-action-btn danger" onclick={bulkDeleteSelectedRows} title="Delete Selected">
					<Trash2 size={13} />
					<span>Delete</span>
				</button>
				<div class="bulk-divider"></div>
				<button type="button" class="bulk-close-btn" onclick={clearSelection} title="Clear Selection">
					<X size={13} />
				</button>
			</div>
		{/if}
	</div>

	<!-- Scrollable Table -->
	<div class="db-table-layout">
		{#if editable}
			<div
				class="db-checkbox-gutter"
				bind:this={gutterElement}
				style={gutterHeight ? `height: ${gutterHeight}px;` : ''}
				aria-label="Row selectors"
			>
				<div
					class="db-checkbox-header-cell"
					style={headerTop !== null ? `position: absolute; top: ${headerTop}px; height: ${headerHeight}px;` : ''}
				>
					<button
						type="button"
						class="row-checkbox-floating"
						role="checkbox"
						aria-checked={visibleRows().length > 0 && visibleRows().every((row: any) => selectedRowIds.includes(row.id))}
						class:checked={visibleRows().length > 0 && visibleRows().every((row: any) => selectedRowIds.includes(row.id))}
						onclick={(e) => { e.stopPropagation(); toggleSelectAll(visibleRows()); }}
						title="Select All Visible"
					>
						{#if visibleRows().length > 0 && visibleRows().every((row: any) => selectedRowIds.includes(row.id))}
							<span class="check-mark-icon">✓</span>
						{/if}
					</button>
				</div>
				{#each visibleRows() as row, rowIdx (row.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="db-checkbox-row-cell"
						style={rowTops[rowIdx] !== undefined ? `position: absolute; top: ${rowTops[rowIdx]}px; height: ${rowHeights[rowIdx]}px;` : ''}
						class:row-hovered={hoveredRowId === row.id}
						class:row-selected={selectedRowIds.includes(row.id)}
						onmouseenter={() => (hoveredRowId = row.id)}
						onmouseleave={() => (hoveredRowId = null)}
						onclick={(e) => { e.stopPropagation(); toggleRowSelection(row.id, e.shiftKey); }}
					>
						<button
							type="button"
							class="row-checkbox-floating"
							class:checked={selectedRowIds.includes(row.id)}
							onclick={(e) => { e.stopPropagation(); toggleRowSelection(row.id, e.shiftKey); }}
							title="Select Row"
						>
							{#if selectedRowIds.includes(row.id)}
								<span class="check-mark-icon">✓</span>
							{/if}
						</button>
					</div>
				{/each}
			</div>
		{/if}

		<div class="db-table-wrapper" class:has-open-popover={activeSelectDropdown !== null || activeColumnMenu !== null}>
		<table class="db-table" class:has-summary={showSummary} bind:this={tableElement}>
			<thead>
				<tr>
					<!-- Column headers -->
					{#each columns as col, colIdx (col.id)}
						<th class="db-th" class:last-col={colIdx === columns.length - 1} data-col-id={col.id} style="width: {getColumnWidth(col)}; min-width: 90px;">
							<div class="th-content">
								<button class="th-sort-btn" onclick={() => toggleSort(col.id)} title="Sort Column">
									<span class="th-type-icon">
										{#if col.type === 'text'}<Type size={12} />{/if}
										{#if col.type === 'number'}<Hash size={12} />{/if}
										{#if col.type === 'date'}<Calendar size={12} />{/if}
										{#if col.type === 'status' || col.type === 'multi-select'}<CheckSquare size={12} />{/if}
									</span>
									<span class="col-name">{col.name}</span>
									{#if sortColumn === col.id}
										{#if sortDirection === 'asc'}
											<span class="active-sort"><ArrowUp size={12} /></span>
										{:else}
											<span class="active-sort"><ArrowDown size={12} /></span>
										{/if}
									{:else}
										<span class="sort-icon"><ArrowUpDown size={12} /></span>
									{/if}
								</button>

								{#if editable}
									<button class="th-menu-trigger" onclick={(e) => { e.stopPropagation(); activeColumnMenu = activeColumnMenu === col.id ? null : col.id; activeSelectDropdown = null; }}>
										<Settings size={12} />
									</button>
								{/if}
							</div>

							<!-- Column settings menu -->
							{#if activeColumnMenu === col.id}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="th-menu-popover" class:open-left={colIdx >= columns.length - 1} onclick={(e) => e.stopPropagation()}>
									<div class="popover-section">
										<label for="col-name-input-{col.id}">Column Name</label>
										<input 
											id="col-name-input-{col.id}"
											type="text" 
											value={col.name} 
											oninput={(e) => renameColumn(col.id, e.currentTarget.value)}
											onkeydown={(e) => e.stopPropagation()}
											placeholder="Rename column..."
										/>
									</div>

									<div class="popover-section">
										<label for="col-type-select-{col.id}">Column Type</label>
										<div class="select-wrapper">
											<select 
												id="col-type-select-{col.id}"
												value={col.type} 
												onchange={(e) => updateColumnType(col.id, e.currentTarget.value)}
												onkeydown={(e) => e.stopPropagation()}
											>
												<option value="text">Text</option>
												<option value="number">Number</option>
												<option value="date">Date</option>
												<option value="status">Status (Single-Select)</option>
												<option value="multi-select">Multi-Select</option>
											</select>
											<span class="select-chevron"><ChevronDown size={12} /></span>
									</div>
									</div>

									{#if col.type === 'status'}
										<div class="popover-section status-options-section">
											<span class="popover-section-label">Status options</span>
											{#if (options[col.id] || []).length > 0}
												<div class="status-option-editor-list">
													{#each options[col.id] || [] as option, optIdx (option)}
														<div class="status-option-editor-row">
															<div class="option-reorder-btns">
																<button
																	type="button"
																	class="option-move-btn"
																	disabled={optIdx === 0}
																	onclick={(e) => { e.stopPropagation(); moveOption(col.id, option, -1); }}
																	title="Move up"
																>
																	<ChevronUp size={11} />
																</button>
																<button
																	type="button"
																	class="option-move-btn"
																	disabled={optIdx === (options[col.id] || []).length - 1}
																	onclick={(e) => { e.stopPropagation(); moveOption(col.id, option, 1); }}
																	title="Move down"
																>
																	<ChevronDown size={11} />
																</button>
															</div>
															<input
																type="text"
																value={option}
																aria-label={`Rename status ${option}`}
																onchange={(e) => {
																	const input = e.currentTarget;
																	if (!renameOption(col.id, option, input.value)) input.value = option;
																}}
																onkeydown={(e) => e.stopPropagation()}
															/>
															<button
																type="button"
																class="option-delete-btn"
																onclick={(e) => { e.stopPropagation(); removeOption(col.id, option); }}
																title={`Delete status ${option}`}
															>
																<X size={11} />
															</button>
														</div>
													{/each}
												</div>
											{:else}
												<span class="status-options-empty">No status options yet</span>
											{/if}
										</div>
									{/if}

									{#if col.type === 'number'}
										<div class="popover-section">
											<label for="col-summary-select-{col.id}">Summary calculation</label>
											<div class="select-wrapper">
												<select
													id="col-summary-select-{col.id}"
													value={getSummaryMode(col.id)}
													onchange={(e) => updateSummaryMode(col.id, e.currentTarget.value)}
													onkeydown={(e) => e.stopPropagation()}
												>
													<option value="sum">Sum</option>
													<option value="min">Minimum</option>
													<option value="max">Maximum</option>
												</select>
												<span class="select-chevron"><ChevronDown size={12} /></span>
											</div>
										</div>
									{/if}
									<div class="column-move-actions">
										<button
											type="button"
											class="column-move-btn"
											disabled={colIdx === 0}
											onclick={(e) => { e.stopPropagation(); moveColumn(col.id, -1); }}
											title={colIdx === 0 ? 'Already first' : 'Move column left'}
										>
											<ArrowLeft size={13} />
											<span>Move left</span>
										</button>
										<button
											type="button"
											class="column-move-btn"
											disabled={colIdx === columns.length - 1}
											onclick={(e) => { e.stopPropagation(); moveColumn(col.id, 1); }}
											title={colIdx === columns.length - 1 ? 'Already last' : 'Move column right'}
										>
											<ArrowRight size={13} />
											<span>Move right</span>
										</button>
									</div>

									<button
										type="button"
										class="column-delete-btn"
										disabled={columns.length <= 1}
										onclick={(e) => { e.stopPropagation(); deleteColumn(col.id); }}
										title={columns.length <= 1 ? 'A table must have at least one column' : 'Delete column'}
									>
										<Trash2 size={13} />
										<span>Delete column</span>
									</button>

								</div>
							{/if}

							<!-- Column resize handle -->
							{#if editable}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div
									class="col-resizer"
									class:active={resizingColId === col.id}
									onclick={(e) => e.stopPropagation()}
									onmousedown={(e) => startResizeColumn(col.id, e)}
								></div>
							{/if}
						</th>
					{/each}
				</tr>
			</thead>
			
			<tbody>
				{#each visibleRows() as row, rowIdx (row.id)}
					<tr
						data-row-id={row.id}
						class:row-selected={selectedRowIds.includes(row.id)}
						class:row-hovered={hoveredRowId === row.id}
						onmouseenter={() => (hoveredRowId = row.id)}
						onmouseleave={() => (hoveredRowId = null)}
					>
						<!-- Cell inputs -->
						{#each columns as col, colIdx (col.id)}
							<td class="db-td" data-col-id={col.id}>
								{#if col.type === 'text'}
									<input 
										type="text" 
										value={row[col.id] || ''} 
										oninput={(e) => updateCell(row.id, col.id, e.currentTarget.value)}
										onkeydown={(e) => e.stopPropagation()}
										placeholder="Empty"
										readonly={!editable}
									/>
								{:else if col.type === 'number'}
									<input 
										type="number" 
										value={row[col.id] ?? ''} 
										oninput={(e) => updateCell(row.id, col.id, e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
										onkeydown={(e) => e.stopPropagation()}
										placeholder="0"
										readonly={!editable}
									/>
								{:else if col.type === 'date'}
									<input 
										type="date" 
										value={row[col.id] || ''} 
										onchange={(e) => updateCell(row.id, col.id, e.currentTarget.value)}
										onkeydown={(e) => e.stopPropagation()}
										readonly={!editable}
									/>
								{:else if col.type === 'status'}
									{@const val = row[col.id]}
									<button 
										type="button"
										class="tag-trigger-btn"
										aria-label={`${col.name} for row ${row.id}`}
										aria-expanded={activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id}
										onclick={(e) => { e.stopPropagation(); activeSelectDropdown = activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id ? null : { rowId: row.id, colId: col.id }; activeColumnMenu = null; }}
										disabled={!editable}
									>
										{#if val}
											{@const style = getTagColor(val)}
											<span class="tag-pill" style="background-color: {style.bg}; color: {style.text}; border-color: {style.text};">
												{val}
											</span>
										{:else}
											<span class="tag-placeholder">Select Option</span>
										{/if}
										{#if editable}
											<span class="chevron"><ChevronDown size={12} /></span>
										{/if}
									</button>
								{:else if col.type === 'multi-select'}
									{@const vals = Array.isArray(row[col.id]) ? row[col.id] : []}
									<button 
										type="button"
										class="tag-trigger-btn multi"
										aria-label={`${col.name} for row ${row.id}`}
										aria-expanded={activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id}
										onclick={(e) => { e.stopPropagation(); activeSelectDropdown = activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id ? null : { rowId: row.id, colId: col.id }; activeColumnMenu = null; }}
										disabled={!editable}
									>
										<div class="tag-list">
											{#if vals.length > 0}
											{#each vals as val (val)}
													{@const style = getTagColor(val)}
															<span class="tag-pill" style="background-color: {style.bg}; color: {style.text}; border-color: {style.text};">
														{val}
													</span>
												{/each}
											{:else}
												<span class="tag-placeholder">Select Options</span>
											{/if}
										</div>
										{#if editable}
											<span class="chevron"><ChevronDown size={12} /></span>
										{/if}
									</button>
								{/if}

								<!-- Options Popover (Status / Multi-Select) -->
								{#if activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id}
									{@const isMulti = col.type === 'multi-select'}
									{@const isBottomRow = rowIdx >= visibleRows().length - 2}
									{@const isRightCol = colIdx >= columns.length - 1}
									<div class="tag-select-popover" class:open-up={isBottomRow} class:open-left={isRightCol}>
										<div class="options-list">
											{#each options[col.id] || [] as option, optIdx (option)}
												{@const isSel = isOptionSelected(row, col.id, option, isMulti)}
												{@const style = getTagColor(option)}
												<div 
													class="option-item" 
													onclick={() => toggleOptionSelection(row, col.id, option, isMulti)}
													tabindex="0"
													role="button"
													onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOptionSelection(row, col.id, option, isMulti); } }}
												>
													<span class="tag-pill" style="background-color: {style.bg}; color: {style.text}; border-color: {style.text};">
														{option}
													</span>
													<div class="option-actions">
														{#if isSel}
															<span class="check-mark">✓</span>
														{/if}
														{#if editable}
															<button 
																type="button"
																class="option-move-btn"
																disabled={optIdx === 0}
																onclick={(e) => { e.stopPropagation(); moveOption(col.id, option, -1); }}
																title="Move up"
															>
																<ChevronUp size={11} />
															</button>
															<button 
																type="button"
																class="option-move-btn"
																disabled={optIdx === (options[col.id] || []).length - 1}
																onclick={(e) => { e.stopPropagation(); moveOption(col.id, option, 1); }}
																title="Move down"
															>
																<ChevronDown size={11} />
															</button>
															<button 
																type="button"
																class="option-delete-btn" 
																onclick={(e) => { e.stopPropagation(); removeOption(col.id, option); }}
																title="Remove Option"
															>
																<X size={10} />
															</button>
														{/if}
													</div>
												</div>
											{/each}
										</div>

										{#if editable}
											<div class="add-option-wrapper">
												<input 
													type="text" 
													placeholder="New option..." 
													bind:value={newOptionText}
													onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); addOption(col.id); } }}
												/>
												<button class="add-option-btn" onclick={() => addOption(col.id)}>
													<PlusCircle size={14} />
												</button>
											</div>
										{/if}
									</div>
								{/if}
							</td>
						{/each}
					</tr>
				{/each}
			</tbody>
			{#if showSummary}
				<tfoot>
					<tr class="db-summary-row">
						{#each columns as col, colIdx (col.id)}
							<td class="db-summary-cell">
								{#if col.type === 'number'}
									{@const mode = getSummaryMode(col.id)}
									<span class="summary-value-label">{summaryLabel(mode)}</span>
									<strong>{getSummaryValue(col.id, mode)}</strong>
								{:else if colIdx === 0}
									<span class="summary-row-count">
										{#if !showAllRows && processedRows().length > ROW_LIMIT}
											Showing {visibleRows().length} of {processedRows().length} rows
										{:else}
											{processedRows().length} {processedRows().length === 1 ? 'row' : 'rows'}
										{/if}
									</span>
								{:else}
									<span class="summary-empty">—</span>
								{/if}
							</td>
						{/each}
					</tr>
				</tfoot>
			{/if}
		</table>
		</div>
		{#if editable}
			<button type="button" class="add-column-btn" aria-label="Add column" title="Add column" onclick={addColumn}>
				<Plus size={14} />
			</button>
		{/if}
	</div>
	{#if processedRows().length > ROW_LIMIT}
		<div class="db-pagination-bar" class:has-gutter={editable}>
			{#if !showAllRows}
				<button
					type="button"
					class="see-more-btn"
					onclick={() => (showAllRows = true)}
				>
					<ChevronDown size={14} />
					<span>See more ({processedRows().length - ROW_LIMIT} remaining)</span>
				</button>
				<span class="see-more-info">Showing {visibleRows().length} of {processedRows().length} rows</span>
			{:else}
				<button
					type="button"
					class="see-more-btn collapse"
					onclick={() => (showAllRows = false)}
				>
					<ChevronUp size={14} />
					<span>Show less</span>
				</button>
				<span class="see-more-info">All {processedRows().length} rows shown</span>
			{/if}
		</div>
	{/if}
</div>

<style>
	.db-block-container {
		margin: 1rem 0;
		overflow: visible;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	.db-block-container button:focus-visible,
	.db-block-container input:focus-visible,
	.db-block-container select:focus-visible {
		outline: 1px solid var(--accent-color);
		outline-offset: 0;
	}

	/* Header bar */
	.db-header-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 4px 0 8px 0;
		width: fit-content;
		max-width: 100%;
	}

	/* Bulk Toolbar */
	.db-bulk-toolbar {
		display: flex;
		align-items: center;
		gap: 8px;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 4px 10px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
		animation: fadeIn 0.15s ease;
	}

	.bulk-count {
		font-size: 12px;
		font-weight: 600;
		color: var(--accent-color);
	}

	.bulk-divider {
		width: 1px;
		height: 14px;
		background-color: var(--border-color);
	}

	.bulk-action-btn {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		font-weight: 500;
		color: var(--text-muted);
		padding: 3px 8px;
		border-radius: 4px;
		transition: all 0.15s ease;
	}

	.bulk-action-btn:hover {
		color: var(--text-main);
		background-color: var(--hover-icon);
	}

	.bulk-action-btn.danger:hover {
		color: var(--color-red);
		background-color: color-mix(in srgb, var(--color-red) 15%, transparent);
	}

	.bulk-close-btn {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		padding: 2px;
		border-radius: 4px;
	}

	.bulk-close-btn:hover {
		color: var(--text-main);
		background-color: var(--hover-icon);
	}

	.db-search-wrapper {
		display: flex;
		align-items: center;
		gap: 6px;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 0 10px;
		height: 34px;
		box-sizing: border-box;
		width: 180px;
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
	}

	.db-search-wrapper:focus-within {
		border-color: var(--border-color);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
	}

	.db-search-wrapper :global(.search-icon) {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.db-search-input {
		font-size: 13px;
		width: 100%;
		height: 100%;
		border: 0;
		outline: none;
		box-shadow: none;
		background: transparent;
		color: var(--text-main);
	}

	.db-search-input:focus,
	.db-search-input:focus-visible {
		border: 0 !important;
		outline: none !important;
		box-shadow: none !important;
	}

	.db-search-input::placeholder {
		color: var(--text-muted);
		opacity: 0.8;
	}

	.db-filter-wrapper {
		position: relative;
		flex: 0 0 auto;
	}

	.db-filter-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		box-sizing: border-box;
		padding: 0 10px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		font-size: 12px;
		color: var(--text-muted);
		background: var(--bg-canvas);
	}

	.db-filter-btn:hover,
	.db-filter-btn:focus-visible,
	.db-filter-btn.active {
		color: var(--text-main);
		border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
		background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-canvas));
	}


	.db-add-row-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 34px;
		box-sizing: border-box;
		padding: 0 11px;
		border: 1px solid color-mix(in srgb, var(--accent-color) 45%, var(--border-color));
		border-radius: 6px;
		font-size: 12px;
		font-weight: 500;
		color: var(--accent-color);
		background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-canvas));
		transition: all 0.15s ease;
		cursor: pointer;
		white-space: nowrap;
	}

	.db-add-row-btn:hover,
	.db-add-row-btn:focus-visible {
		color: #ffffff;
		background: var(--accent-color);
		border-color: var(--accent-color);
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
	}


	.db-filter-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 1000;
		width: 240px;
		max-width: calc(100vw - 32px);
		max-height: calc(100vh - 120px);
		overflow-y: auto;
		box-sizing: border-box;
		padding: 14px;
		border: 1px solid var(--border-color);
		border-radius: 10px;
		background: color-mix(in srgb, var(--bg-canvas) 92%, var(--border-color));
		backdrop-filter: blur(12px);
		box-shadow: 0 12px 28px -6px rgba(0, 0, 0, 0.18), 0 4px 12px -2px rgba(0, 0, 0, 0.08);
		display: flex;
		flex-direction: column;
		gap: 12px;
		animation: popoverFadeIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
		transform-origin: top left;
	}

	@keyframes popoverFadeIn {
		from {
			opacity: 0;
			transform: scale(0.96) translateY(-4px);
		}
		to {
			opacity: 1;
			transform: scale(1) translateY(0);
		}
	}

	@media (max-width: 640px) {
		.db-header-bar {
			flex-wrap: wrap;
			max-width: 100%;
			gap: 8px;
		}

		.db-search-wrapper {
			flex: 1 1 140px;
			max-width: 100%;
		}

		.db-filter-popover {
			left: auto;
			right: 0;
			width: min(250px, calc(100vw - 32px));
			transform-origin: top right;
		}
	}

	.filter-popover-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-bottom: 8px;
		border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
	}

	.filter-title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		font-weight: 600;
		color: var(--text-main);
		letter-spacing: -0.01em;
	}

	.filter-title :global(.filter-header-icon) {
		color: var(--accent-color);
	}

	.filter-badge {
		font-size: 10px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 10px;
		background-color: color-mix(in srgb, var(--accent-color) 15%, transparent);
		color: var(--accent-color);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.filter-field label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-muted);
	}

	.filter-select-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.filter-select-wrapper select,
	.filter-input-field {
		width: 100%;
		height: 32px;
		padding: 0 28px 0 10px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		font-size: 12px;
		color: var(--text-main);
		background-color: var(--bg-canvas);
		appearance: none;
		outline: none;
		transition: all 0.15s ease;
	}

	.filter-input-field {
		padding: 0 10px;
	}

	.filter-select-wrapper select:hover,
	.filter-input-field:hover {
		border-color: color-mix(in srgb, var(--accent-color) 40%, var(--border-color));
	}

	.filter-select-wrapper select:focus,
	.filter-input-field:focus {
		border-color: var(--accent-color);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-color) 18%, transparent);
	}

	.filter-select-wrapper :global(.filter-chevron) {
		position: absolute;
		right: 9px;
		pointer-events: none;
		color: var(--text-muted);
		transition: transform 0.15s ease;
	}

	.filter-popover-footer {
		padding-top: 4px;
		border-top: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
	}

	.filter-clear-btn {
		width: 100%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 10px;
		border-radius: 6px;
		border: 1px solid transparent;
		color: var(--text-muted);
		font-size: 12px;
		font-weight: 500;
		background: transparent;
		transition: all 0.15s ease;
		cursor: pointer;
	}

	.filter-clear-btn:hover:not(:disabled) {
		color: var(--color-red, #ef4444);
		background-color: color-mix(in srgb, var(--color-red, #ef4444) 10%, transparent);
		border-color: color-mix(in srgb, var(--color-red, #ef4444) 20%, transparent);
	}

	.filter-clear-btn:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	/* Table Wrapper */
	.db-table-layout {
		display: flex;
		align-items: flex-start;
		gap: 4px;
		width: fit-content;
		max-width: 100%;
		align-self: flex-start;
	}

	.db-table-wrapper {
		overflow-x: auto;
		overflow-y: hidden;
		width: fit-content;
		max-width: 100%;
		align-self: flex-start;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background-color: var(--bg-canvas);
		box-sizing: border-box;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
	}

	.db-checkbox-gutter {
		position: relative;
		display: flex;
		flex-direction: column;
		flex: 0 0 22px;
		width: 22px;
		margin-right: 4px;
		user-select: none;
	}

	.db-checkbox-header-cell {
		left: 0;
		width: 22px;
		height: 34px;
		min-height: 34px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
	}

	.db-checkbox-row-cell {
		left: 0;
		width: 22px;
		height: 38px;
		min-height: 38px;
		display: flex;
		align-items: center;
		justify-content: center;
		box-sizing: border-box;
	}

	.db-table {
		width: max-content;
		border-collapse: separate;
		border-spacing: 0;
		table-layout: fixed;
		font-size: 13px;
	}

	/* Table Headers */
	.db-th {
		position: relative;
		border-bottom: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
	}

	.db-table .db-th {
		height: 34px;
		min-height: 34px;
		padding: 0;
		vertical-align: middle;
		line-height: 1.2;
		background-color: color-mix(in srgb, var(--bg-canvas) 88%, var(--border-color));
	}

	.db-table thead tr th:first-child {
		border-top-left-radius: 5px;
	}

	.db-table thead tr th:last-child {
		border-top-right-radius: 5px;
		border-right: none;
	}

	.row-checkbox-floating {
		width: 16px;
		height: 16px;
		min-width: 16px;
		min-height: 16px;
		border-radius: 4px;
		border: 1.5px solid color-mix(in srgb, var(--text-muted) 85%, var(--text-main));
		background-color: var(--bg-canvas, #ffffff);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		transition: all 0.15s ease;
		opacity: 0.85;
		margin: 0;
		box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
	}

	.row-checkbox-floating:hover,
	.row-checkbox-floating.checked,
	.db-checkbox-header-cell:hover .row-checkbox-floating,
	.db-checkbox-row-cell:hover .row-checkbox-floating,
	.db-checkbox-row-cell.row-hovered .row-checkbox-floating,
	.db-checkbox-row-cell.row-selected .row-checkbox-floating {
		opacity: 1;
	}

	.row-checkbox-floating:hover {
		border-color: var(--text-main);
		background-color: var(--hover-icon);
		transform: scale(1.06);
	}

	.row-checkbox-floating.checked {
		background-color: var(--accent-color);
		border: 1.5px solid #ffffff;
		box-shadow: 0 0 0 1.5px var(--accent-color), 0 2px 4px rgba(0, 0, 0, 0.25);
		opacity: 1;
	}

	/* Dark mode and high-contrast / blue mode visibility */
	:global(html.dark) .row-checkbox-floating,
	:global(.dark) .row-checkbox-floating {
		border: 1.5px solid rgba(255, 255, 255, 0.6);
		background-color: #252525;
		opacity: 0.9;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.12);
	}

	:global(html.dark) .row-checkbox-floating:hover,
	:global(.dark) .row-checkbox-floating:hover {
		border-color: #ffffff;
		background-color: #383838;
		box-shadow: 0 2px 5px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.25);
	}

	:global(html.dark) .row-checkbox-floating.checked,
	:global(.dark) .row-checkbox-floating.checked {
		background-color: var(--accent-color);
		border: 1.5px solid #ffffff;
		box-shadow: 0 0 0 1.5px var(--accent-color), 0 2px 5px rgba(0, 0, 0, 0.7);
	}

	.check-mark-icon {
		color: #ffffff;
		font-size: 11px;
		font-weight: 800;
		line-height: 1;
		user-select: none;
		display: flex;
		align-items: center;
		justify-content: center;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5));
	}

	tr.row-selected {
		background-color: color-mix(in srgb, var(--accent-color) 14%, transparent) !important;
	}

	tr.row-hovered {
		background-color: color-mix(in srgb, var(--accent-color) 5%, transparent);
	}

	.col-resizer {
		position: absolute;
		top: 0;
		right: 0;
		width: 8px;
		height: 100%;
		cursor: col-resize;
		user-select: none;
		z-index: 20;
	}

	.col-resizer::after {
		content: '';
		position: absolute;
		top: 0;
		right: 0;
		width: 2px;
		height: 500px;
		background-color: var(--accent-color);
		opacity: 0;
		transition: opacity 0.15s ease;
		pointer-events: none;
	}

	.col-resizer:hover::after,
	.col-resizer.active::after {
		opacity: 1;
	}

	.th-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
	}

	.db-table .th-content {
		min-height: 32px;
		padding: 4px 8px;
	}

	.th-sort-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		color: var(--text-muted);
		width: 100%;
		text-align: left;
	}

	.th-sort-btn:hover {
		color: var(--text-main);
	}

	.th-type-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		opacity: 0.7;
	}

	.col-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		flex-grow: 1;
	}

	.sort-icon {
		opacity: 0;
		color: var(--text-muted);
		transition: opacity 0.15s ease;
		display: inline-flex;
		align-items: center;
	}

	.th-content:hover .sort-icon {
		opacity: 0.5;
	}

	.active-sort {
		color: var(--accent-color);
		display: inline-flex;
		align-items: center;
	}

	.th-menu-trigger {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		padding: 4px;
		border-radius: 4px;
		opacity: 0;
		transition: opacity 0.15s ease, background-color 0.15s ease;
	}

	.th-content:hover .th-menu-trigger {
		opacity: 0.7;
	}

	.th-menu-trigger:hover {
		opacity: 1 !important;
		background-color: var(--hover-icon);
	}

	/* Popover menus */
	.th-menu-popover {
		position: absolute;
		top: calc(100% + 4px);
		left: 8px;
		z-index: 1000;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.15);
		padding: 12px;
		width: 200px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.db-th.last-col .th-menu-popover {
		left: auto;
		right: 8px;
	}

	.popover-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.popover-section label,
	.popover-section-label {
		font-size: 10px;
		text-transform: uppercase;
		font-weight: 600;
		color: var(--text-muted);
		letter-spacing: 0.05em;
	}

	.popover-section input {
		font-size: 12px;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		padding: 6px 8px;
		color: var(--text-main);
		background-color: var(--bg-canvas);
	}

	.popover-section input:focus {
		border-color: var(--accent-color);
	}

	.status-option-editor-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
		max-height: 140px;
		overflow-y: auto;
	}

	.status-option-editor-row {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.option-reorder-btns {
		display: inline-flex;
		flex-direction: column;
		gap: 1px;
		flex-shrink: 0;
	}

	.option-move-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		padding: 1px 2px;
		border-radius: 3px;
		cursor: pointer;
		opacity: 0.65;
		transition: all 0.15s ease;
		background: transparent;
		line-height: 1;
	}

	.option-move-btn:hover:not(:disabled) {
		opacity: 1;
		color: var(--text-main);
		background-color: var(--hover-icon);
	}

	.option-move-btn:disabled {
		opacity: 0.2;
		cursor: not-allowed;
	}

	.status-option-editor-row input {
		min-width: 0;
		flex: 1;
	}

	.status-option-editor-row .option-delete-btn {
		flex: 0 0 auto;
	}

	.status-options-empty {
		font-size: 11px;
		color: var(--text-muted);
	}

	.select-wrapper {
		position: relative;
		display: flex;
		align-items: center;
	}

	.select-wrapper select {
		font-size: 12px;
		width: 100%;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		padding: 6px 24px 6px 8px;
		color: var(--text-main);
		background-color: var(--bg-canvas);
		appearance: none;
		outline: none;
	}

	.select-wrapper select:focus {
		border-color: var(--accent-color);
	}

	.column-move-actions {
		display: flex;
		gap: 6px;
		padding-top: 2px;
	}

	.column-move-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		flex: 1;
		padding: 6px 5px;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		color: var(--text-muted);
		font-size: 11px;
	}

	.column-move-btn:hover:not(:disabled),
	.column-move-btn:focus-visible:not(:disabled) {
		color: var(--text-main);
		background: var(--hover-icon);
	}

	.column-move-btn:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}

	.column-delete-btn {
		display: inline-flex;
		align-items: center;
		justify-content: flex-start;
		gap: 6px;
		width: 100%;
		margin-top: 2px;
		padding: 8px 0 0;
		border-top: 1px solid var(--border-color);
		color: var(--error-color);
		font-size: 12px;
		text-align: left;
	}

	.column-delete-btn:hover:not(:disabled),
	.column-delete-btn:focus-visible:not(:disabled) {
		color: var(--error-color);
		background: color-mix(in srgb, var(--error-color) 8%, transparent);
	}

	.column-delete-btn:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.select-chevron {
		position: absolute;
		right: 8px;
		color: var(--text-muted);
		pointer-events: none;
		display: inline-flex;
		align-items: center;
	}

	/* Table Cells */
	.db-td {
		position: relative;
		border-bottom: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		padding: 0;
		height: 38px;
	}

	.db-table tbody tr td:last-child {
		border-right: none;
	}

	.db-table:not(.has-summary) tbody tr:last-child td {
		border-bottom: none;
	}

	.db-table:not(.has-summary) tbody tr:last-child td:first-child {
		border-bottom-left-radius: 5px;
	}

	.db-table:not(.has-summary) tbody tr:last-child td:last-child {
		border-bottom-right-radius: 5px;
	}

	.db-summary-row {
		background: color-mix(in srgb, var(--bg-canvas) 88%, var(--border-color));
	}

	.db-summary-cell {
		height: 34px;
		padding: 6px 10px;
		border-top: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		border-bottom: none;
		color: var(--text-muted);
		font-size: 12px;
		white-space: nowrap;
	}

	.db-summary-row td:last-child {
		border-right: none;
	}

	.db-summary-row td:first-child {
		border-bottom-left-radius: 5px;
	}

	.db-summary-row td:last-child {
		border-bottom-right-radius: 5px;
	}


	.summary-row-count {
		font-weight: 600;
		color: var(--text-main);
	}

	.summary-value-label {
		margin-right: 6px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.summary-empty {
		opacity: 0.55;
	}

	.add-column-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		margin-top: 8px;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: 5px;
		color: var(--text-muted);
	}

	.add-column-btn:hover,
	.add-column-btn:focus-visible {
		color: var(--text-main);
		background: var(--hover-icon);
	}

	.db-pagination-bar {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 8px;
		padding: 2px 0;
		align-self: flex-start;
	}

	.db-pagination-bar.has-gutter {
		margin-left: 26px;
	}

	.see-more-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 12px;
		font-size: 12px;
		font-weight: 500;
		color: var(--accent-color);
		background: var(--bg-canvas);
		border: 1px solid color-mix(in srgb, var(--accent-color) 35%, var(--border-color));
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.see-more-btn:hover,
	.see-more-btn:focus-visible {
		background: color-mix(in srgb, var(--accent-color) 12%, var(--bg-canvas));
		border-color: var(--accent-color);
	}

	.see-more-btn.collapse {
		color: var(--text-muted);
		border-color: var(--border-color);
	}

	.see-more-btn.collapse:hover,
	.see-more-btn.collapse:focus-visible {
		color: var(--text-main);
		background: var(--hover-icon);
		border-color: color-mix(in srgb, var(--border-color) 80%, var(--text-main));
	}

	.see-more-info {
		font-size: 12px;
		color: var(--text-muted);
	}

	.db-td input {
		width: 100%;
		height: 38px;
		padding: 8px 10px;
		font-size: 13px;
		border-radius: 0;
		color: var(--text-main);
		background-color: transparent;
		transition: background-color 0.15s ease;
	}

	.db-td input:focus {
		background-color: color-mix(in srgb, var(--accent-color) 3%, transparent);
		box-shadow: inset 0 0 0 1px var(--accent-color);
	}

	.db-td input:focus-visible {
		outline: none;
		box-shadow: inset 0 0 0 1px var(--accent-color);
	}

	/* Custom Tag components */
	.tag-trigger-btn {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		height: 38px;
		padding: 8px 10px;
		text-align: left;
		background: transparent;
	}

	.tag-trigger-btn:hover:not(:disabled) {
		background-color: color-mix(in srgb, var(--accent-color) 3%, transparent);
	}

	.tag-trigger-btn .chevron {
		color: var(--text-muted);
		opacity: 0.5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
	}

	.tag-placeholder {
		color: var(--text-muted);
		opacity: 0.5;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		overflow: hidden;
		max-height: 24px;
	}

	.tag-pill {
		display: inline-block;
		font-size: 11px;
		font-weight: 500;
		padding: 2px 8px;
		border-radius: 12px;
		white-space: nowrap;
		line-height: 1.2;
	}

	/* Select Popover */
	.tag-select-popover {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 1000;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.12);
		padding: 8px;
		width: 220px;
		max-width: calc(100vw - 32px);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.tag-select-popover.open-up {
		top: auto;
		bottom: calc(100% + 4px);
		box-shadow: 0 -10px 25px -5px rgba(0, 0, 0, 0.18), 0 -8px 10px -6px rgba(0, 0, 0, 0.12);
	}

	.tag-select-popover.open-left {
		left: auto;
		right: 0;
	}

	.options-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-height: 160px;
		overflow-y: auto;
	}

	.option-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 8px;
		border-radius: 6px;
		text-align: left;
		width: 100%;
		transition: background-color 0.15s ease;
		cursor: pointer;
		outline: none;
	}

	.option-item:hover, .option-item:focus {
		background-color: var(--hover-icon);
	}

	.option-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.check-mark {
		color: var(--accent-color);
		font-weight: bold;
	}

	.option-delete-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		padding: 4px;
		border-radius: 4px;
		opacity: 0.5;
	}

	.option-delete-btn:hover {
		opacity: 1;
		background-color: color-mix(in srgb, var(--error-color) 8%, transparent);
		color: var(--error-color);
	}

	.add-option-wrapper {
		display: flex;
		align-items: center;
		gap: 6px;
		border-top: 1px solid var(--border-color);
		padding-top: 8px;
	}

	.add-option-wrapper input {
		font-size: 12px;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		padding: 4px 6px;
		flex-grow: 1;
		color: var(--text-main);
		background-color: var(--bg-canvas);
	}

	.add-option-wrapper input:focus {
		border-color: var(--accent-color);
	}

	.add-option-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--accent-color);
		opacity: 0.8;
	}

	.add-option-btn:hover {
		opacity: 1;
	}
</style>
