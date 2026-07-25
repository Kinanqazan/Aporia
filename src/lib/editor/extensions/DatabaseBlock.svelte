<script lang="ts">
	import { 
		Plus, Trash2, ArrowUp, ArrowDown, ArrowUpDown, ArrowLeft, ArrowRight,
		Settings, Search, Calendar, Hash, Type, CheckSquare, 
		ChevronDown, PlusCircle, X, Copy, Filter
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
	let searchQuery = $state('');
	let isFilterOpen = $state(false);
	let filterColumnId = $state('');
	let filterValue = $state('');
	let activeFilterColumn = $derived(columns.find((column: any) => column.id === filterColumnId));
	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<'asc' | 'desc' | null>(null);
	let sortInitialized = $state(false);
	let selectedRowIds = $state<string[]>([]);
	
	// Popovers & Resizing
	let activeColumnMenu = $state<string | null>(null); // columnId
	let activeSelectDropdown = $state<{ rowId: string; colId: string } | null>(null);
	let isResizing = $state(false);
	let resizingColId = $state<string | null>(null);
	let previewColumnWidth = $state<{ colId: string; width: number } | null>(null);

	// Multi-row Selection & Bulk Actions
	function toggleRowSelection(rowId: string) {
		if (selectedRowIds.includes(rowId)) {
			selectedRowIds = selectedRowIds.filter(id => id !== rowId);
		} else {
			selectedRowIds = [...selectedRowIds, rowId];
		}
	}

	function toggleSelectAll(visibleRows = rows) {
		const allIds = visibleRows.map((r: any) => r.id);
		const allSelected = allIds.length > 0 && allIds.every((id: string) => selectedRowIds.includes(id));
		if (allSelected) {
			selectedRowIds = selectedRowIds.filter(id => !allIds.includes(id));
		} else {
			selectedRowIds = [...new Set([...selectedRowIds, ...allIds])];
		}
	}

	function clearSelection() {
		selectedRowIds = [];
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

	// Click outside detection & custom event listeners using standard Svelte 5 $effect
	$effect(() => {
		const handleDocumentClick = (e: MouseEvent) => {
			if (containerElement && !containerElement.contains(e.target as Node)) {
				activeColumnMenu = null;
				activeSelectDropdown = null;
				isFilterOpen = false;
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
	});

	$effect(() => {
		if (!editable) {
			if (activeColumnMenu !== null) activeColumnMenu = null;
			if (activeSelectDropdown !== null) activeSelectDropdown = null;
			if (isFilterOpen) isFilterOpen = false;
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

				const strA = String(valA).toLowerCase();
				const strB = String(valB).toLowerCase();
				if (strA < strB) return sortDirection === 'asc' ? -1 : 1;
				if (strA > strB) return sortDirection === 'asc' ? 1 : -1;
				return 0;
			});
		}

		return result;
	});

	// Column Actions
	function addColumn() {
		if (!editable) return;
		const newId = generateId();
		const updatedCols = [...columns, { id: newId, name: 'New Column', type: 'text' }];
		const updatedRows = rows.map((r: any) => ({ ...r, [newId]: '' }));
		updateAttributes({ columns: updatedCols, rows: updatedRows });
	}

	function deleteColumn(colId: string) {
		if (!editable || columns.length <= 1) return;

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
				placeholder="Filter table..." 
				bind:value={searchQuery}
				onkeydown={(e) => e.stopPropagation()}
				class="db-search-input"
			/>
		</div>
		<div class="db-filter-wrapper">
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
					<div class="filter-field">
						<label for="database-filter-column">Column</label>
						<select id="database-filter-column" value={filterColumnId} onchange={(e) => { filterColumnId = e.currentTarget.value; filterValue = ''; }}>
							<option value="">Choose a column</option>
							{#each columns as column (column.id)}
								<option value={column.id}>{column.name}</option>
							{/each}
						</select>
					</div>
					{#if activeFilterColumn}
						<div class="filter-field">
							<label for="database-filter-value">Value</label>
							{#if activeFilterColumn.type === 'status' || activeFilterColumn.type === 'multi-select'}
								<select id="database-filter-value" bind:value={filterValue}>
									<option value="">Choose a value</option>
									{#each options[activeFilterColumn.id] || [] as option (option)}
										<option value={option}>{option}</option>
									{/each}
								</select>
							{:else}
								<input
									id="database-filter-value"
									type={activeFilterColumn.type === 'number' || activeFilterColumn.type === 'date' ? activeFilterColumn.type : 'text'}
									bind:value={filterValue}
									placeholder={activeFilterColumn.type === 'number' ? 'Enter a number...' : activeFilterColumn.type === 'date' ? 'Choose a date...' : 'Enter text...'}
									onkeydown={(e) => e.stopPropagation()}
								/>
							{/if}
						</div>
					{:else}
						<p class="filter-help">Choose a column to set its filter value.</p>
					{/if}
					<button type="button" class="filter-clear-btn" onclick={clearFilter} disabled={!filterColumnId && !filterValue}>
						<X size={13} /> Clear filter
					</button>
				</div>
			{/if}
		</div>

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
		<div class="db-table-wrapper" class:has-gutter={editable}>
		<table class="db-table">
			<thead>
				<tr>
					<!-- Column headers -->
					{#each columns as col, colIdx (col.id)}
						<th class="db-th" class:first-col={colIdx === 0 && editable} class:last-col={colIdx === columns.length - 1} data-col-id={col.id} style="width: {getColumnWidth(col)}; min-width: 90px;">
							{#if colIdx === 0 && editable}
								<button
									type="button"
									class="row-checkbox-floating"
									role="checkbox"
									class:checked={processedRows().length > 0 && processedRows().every((row: any) => selectedRowIds.includes(row.id))}
									class:indeterminate={processedRows().some((row: any) => selectedRowIds.includes(row.id)) && !processedRows().every((row: any) => selectedRowIds.includes(row.id))}
									aria-label="Select visible rows"
									aria-checked={processedRows().length > 0 && processedRows().every((row: any) => selectedRowIds.includes(row.id)) ? 'true' : processedRows().some((row: any) => selectedRowIds.includes(row.id)) ? 'mixed' : 'false'}
									onclick={() => toggleSelectAll(processedRows())}
								>
									{#if processedRows().length > 0 && processedRows().every((row: any) => selectedRowIds.includes(row.id))}
										<span class="check-mark-icon">✓</span>
									{/if}
								</button>
							{/if}
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
								<div class="th-menu-popover" onclick={(e) => e.stopPropagation()}>
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
													{#each options[col.id] || [] as option (option)}
														<div class="status-option-editor-row">
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
					{#each processedRows() as row (row.id)}
					<tr data-row-id={row.id} class:row-selected={selectedRowIds.includes(row.id)}>
						<!-- Cell inputs -->
						{#each columns as col, colIdx (col.id)}
							<td class="db-td" class:first-col={colIdx === 0 && editable} data-col-id={col.id}>
								{#if colIdx === 0 && editable}
									<button
										type="button"
										class="row-checkbox-floating"
										class:checked={selectedRowIds.includes(row.id)}
										onclick={(e) => { e.stopPropagation(); toggleRowSelection(row.id); }}
									>
										{#if selectedRowIds.includes(row.id)}
											<span class="check-mark-icon">✓</span>
										{/if}
									</button>
								{/if}
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
									<div class="tag-select-popover">
										<div class="options-list">
											{#each options[col.id] || [] as option (option)}
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
							<td class="db-summary-cell" class:first-col={colIdx === 0 && editable}>
								{#if col.type === 'number'}
									{@const mode = getSummaryMode(col.id)}
									<span class="summary-value-label">{summaryLabel(mode)}</span>
									<strong>{getSummaryValue(col.id, mode)}</strong>
								{:else if colIdx === 0}
									<span class="summary-row-count">{processedRows().length} {processedRows().length === 1 ? 'row' : 'rows'}</span>
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
	{#if editable}
		<button type="button" class="add-row-btn" aria-label="Add row" title="Add row" onclick={() => updateAttributes({ rows: [...rows, { id: generateId(), ...Object.fromEntries(columns.map((column: any) => [column.id, column.type === 'multi-select' ? [] : ''])) }] })}>
			<Plus size={14} />
		</button>
	{/if}
	{#if editable}
		<button type="button" class="db-summary-btn bottom-summary-btn" class:active={showSummary} aria-label="Toggle summary row" aria-pressed={showSummary} onclick={toggleSummary} title="Toggle summary row">
			<span class="summary-symbol" aria-hidden="true">Σ</span>
		</button>
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
		padding: 4px 10px;
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
		height: 30px;
		padding: 0 9px;
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

	.db-summary-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 30px;
		padding: 0 9px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		font-size: 12px;
		color: var(--text-muted);
		background: var(--bg-canvas);
	}

	.db-summary-btn:hover,
	.db-summary-btn:focus-visible,
	.db-summary-btn.active {
		color: var(--text-main);
		border-color: color-mix(in srgb, var(--accent-color) 55%, var(--border-color));
		background: color-mix(in srgb, var(--accent-color) 8%, var(--bg-canvas));
	}

	.bottom-summary-btn {
		position: absolute;
		left: 56px;
		bottom: 0;
		width: 28px;
		height: 28px;
		padding: 0;
		justify-content: center;
	}

	.summary-symbol {
		font-size: 15px;
		line-height: 1;
		font-weight: 600;
	}

	.db-filter-popover {
		position: absolute;
		top: calc(100% + 6px);
		left: 0;
		z-index: 1000;
		width: 220px;
		padding: 12px;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		background: var(--bg-canvas);
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.15);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.filter-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.filter-field label {
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
	}

	.filter-help {
		margin: -2px 0 0;
		font-size: 11px;
		line-height: 1.4;
		color: var(--text-muted);
	}

	.filter-field input,
	.filter-field select {
		width: 100%;
		min-height: 28px;
		padding: 5px 7px;
		border: 1px solid var(--border-color);
		border-radius: 4px;
		font-size: 12px;
		color: var(--text-main);
		background: var(--bg-canvas);
	}

	.filter-clear-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		padding: 6px 8px;
		border-top: 1px solid var(--border-color);
		color: var(--text-muted);
		font-size: 12px;
	}

	.filter-clear-btn:hover:not(:disabled),
	.filter-clear-btn:focus-visible:not(:disabled) {
		color: var(--text-main);
		background: var(--hover-icon);
	}

	.filter-clear-btn:disabled {
		cursor: not-allowed;
		opacity: 0.45;
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
		border: 1px solid var(--border-color);
		border-radius: 8px;
		background-color: var(--bg-canvas);
		box-sizing: border-box;
		transition: padding-left 0.15s ease;
	}

	.db-table-wrapper.has-gutter {
		padding-left: 28px;
	}

	.db-table {
		width: max-content;
		border-collapse: collapse;
		table-layout: fixed;
		font-size: 13px;
		overflow: visible;
	}

	/* Table Headers */
	.db-th {
		position: relative;
	}

	.db-table .db-th {
		height: 34px;
		min-height: 34px;
		padding: 0;
		vertical-align: middle;
		line-height: 1.2;
		background-color: color-mix(in srgb, var(--bg-canvas) 88%, var(--border-color));
	}

	.db-th.first-col,
	.db-td.first-col {
		position: relative;
		overflow: visible !important;
		border-left: 1px solid var(--border-color);
	}

	.row-checkbox-floating {
		position: absolute;
		left: -24px;
		top: 50%;
		transform: translateY(-50%);
		width: 18px;
		height: 18px;
		min-width: 18px;
		min-height: 18px;
		border-radius: 4px;
		border: 1px solid var(--border-color);
		background-color: transparent;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		padding: 0;
		transition: all 0.15s ease;
		opacity: 1;
		z-index: 25;
		margin: 0;
	}

	.db-th.first-col:hover .row-checkbox-floating,
	tr:hover .row-checkbox-floating,
	.row-checkbox-floating.checked,
	.row-checkbox-floating:hover {
		opacity: 1;
	}

	.row-checkbox-floating.indeterminate::after {
		content: '';
		width: 8px;
		height: 2px;
		background: #fff;
		border-radius: 2px;
	}

	.db-td.first-col > input,
	.db-td.first-col > .tag-trigger-btn {
		width: 100%;
	}

	.row-checkbox-floating:hover {
		border-color: var(--text-muted);
		background-color: var(--hover-icon);
	}

	.row-checkbox-floating.checked {
		background-color: var(--accent-color);
		border-color: var(--accent-color);
	}

	.check-mark-icon {
		color: #ffffff;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		user-select: none;
	}

	tr.row-selected {
		background-color: color-mix(in srgb, var(--accent-color) 14%, transparent) !important;
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

	.db-summary-row {
		background: color-mix(in srgb, var(--bg-canvas) 88%, var(--border-color));
	}

	.db-summary-cell {
		height: 34px;
		padding: 6px 10px;
		border-top: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		color: var(--text-muted);
		font-size: 12px;
		white-space: nowrap;
	}

	.db-summary-cell.first-col {
		border-left: 1px solid var(--border-color);
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

	.add-row-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		align-self: flex-start;
		margin: 8px 0 0 28px;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: 5px;
		color: var(--text-muted);
	}

	.add-row-btn:hover,
	.add-row-btn:focus-visible {
		color: var(--text-main);
		background: var(--hover-icon);
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
		top: 100%;
		left: 0;
		z-index: 60;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
		padding: 8px;
		width: 220px;
		display: flex;
		flex-direction: column;
		gap: 8px;
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
