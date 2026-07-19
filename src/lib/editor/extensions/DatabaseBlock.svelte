<script lang="ts">
	import { 
		Plus, Trash2, ArrowUp, ArrowDown, ArrowUpDown, 
		Settings, Search, Calendar, Hash, Type, CheckSquare, 
		ChevronDown, PlusCircle, X 
	} from 'lucide-svelte';

	let { tiptapNode, updateAttributes, editable } = $props();

	// Reactive bindings to tip-tap state
	let columns = $derived(tiptapNode.node.attrs.columns || []);
	let rows = $derived(tiptapNode.node.attrs.rows || []);
	let options = $derived(tiptapNode.node.attrs.options || {});

	// Local UI states
	let searchQuery = $state('');
	let sortColumn = $state<string | null>(null);
	let sortDirection = $state<'asc' | 'desc' | null>(null);
	
	// Popovers
	let activeColumnMenu = $state<string | null>(null); // columnId
	let activeSelectDropdown = $state<{ rowId: string; colId: string } | null>(null);
	
	// Temporary edit inputs
	let newOptionText = $state('');
	let containerElement = $state<HTMLDivElement>();

	// Click outside detection using standard Svelte 5 $effect
	$effect(() => {
		const handleDocumentClick = (e: MouseEvent) => {
			if (containerElement && !containerElement.contains(e.target as Node)) {
				activeColumnMenu = null;
				activeSelectDropdown = null;
			}
		};
		document.addEventListener('click', handleDocumentClick);
		return () => {
			document.removeEventListener('click', handleDocumentClick);
		};
	});

	// Generate a unique ID
	function generateId() {
		return 'id-' + Math.random().toString(36).substring(2, 11);
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
		if (!editable) return;
		const updatedCols = columns.filter((c: any) => c.id !== colId);
		const updatedRows = rows.map((r: any) => {
			const copy = { ...r };
			delete copy[colId];
			return copy;
		});
		
		const updatedOptions = { ...options };
		delete updatedOptions[colId];

		updateAttributes({ 
			columns: updatedCols, 
			rows: updatedRows,
			options: updatedOptions
		});
		activeColumnMenu = null;
	}

	function updateColumnType(colId: string, newType: string) {
		if (!editable) return;
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
		activeColumnMenu = null;
	}

	function renameColumn(colId: string, newName: string) {
		if (!editable) return;
		const updatedCols = columns.map((c: any) => c.id === colId ? { ...c, name: newName } : c);
		updateAttributes({ columns: updatedCols });
	}

	// Row Actions
	function addRow() {
		if (!editable) return;
		const newRow: any = { id: generateId() };
		columns.forEach((col: any) => {
			newRow[col.id] = col.type === 'multi-select' ? [] : '';
		});
		updateAttributes({ rows: [...rows, newRow] });
	}

	function deleteRow(rowId: string) {
		if (!editable) return;
		const updatedRows = rows.filter((r: any) => r.id !== rowId);
		updateAttributes({ rows: updatedRows });
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

	// Sorting helpers
	function toggleSort(colId: string) {
		if (sortColumn === colId) {
			if (sortDirection === 'asc') {
				sortDirection = 'desc';
			} else if (sortDirection === 'desc') {
				sortColumn = null;
				sortDirection = null;
			}
		} else {
			sortColumn = colId;
			sortDirection = 'asc';
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

<div class="db-block-container" bind:this={containerElement}>
	<!-- Header controls -->
	<div class="db-header-bar">
		<div class="db-search-wrapper">
			<Search class="search-icon" size={14} />
			<input 
				type="text" 
				placeholder="Filter table..." 
				bind:value={searchQuery}
				class="db-search-input"
			/>
		</div>
		
		<div class="db-actions">
			{#if editable}
				<button class="db-btn primary" onclick={addRow}>
					<Plus size={14} /> Add Row
				</button>
			{/if}
		</div>
	</div>

	<!-- Scrollable Table -->
	<div class="db-table-wrapper">
		<table class="db-table">
			<thead>
				<tr>
					<!-- Row actions column -->
					<th class="col-actions-header"></th>
					
					<!-- Column headers -->
					{#each columns as col}
						<th class="db-th">
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
								<div class="th-menu-popover">
									<div class="popover-section">
										<label for="col-name-input-{col.id}">Column Name</label>
										<input 
											id="col-name-input-{col.id}"
											type="text" 
											value={col.name} 
											oninput={(e) => renameColumn(col.id, e.currentTarget.value)}
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

									<div class="popover-actions">
										<button class="popover-btn delete" onclick={() => deleteColumn(col.id)}>
											<Trash2 size={12} /> Delete Column
										</button>
									</div>
								</div>
							{/if}
						</th>
					{/each}
					
					{#if editable}
						<th class="col-add-header">
							<button class="col-add-btn" onclick={addColumn} title="Add Column">
								<Plus size={14} /> Add Column
							</button>
						</th>
					{/if}
				</tr>
			</thead>
			
			<tbody>
				{#each processedRows() as row}
					<tr>
						<!-- Row actions -->
						<td class="col-actions-cell">
							{#if editable}
								<button class="row-delete-btn" onclick={() => deleteRow(row.id)} title="Delete Row">
									<Trash2 size={12} />
								</button>
							{/if}
						</td>

						<!-- Cell inputs -->
						{#each columns as col}
							<td class="db-td">
								{#if col.type === 'text'}
									<input 
										type="text" 
										value={row[col.id] || ''} 
										onchange={(e) => updateCell(row.id, col.id, e.currentTarget.value)}
										placeholder="Empty"
										readonly={!editable}
									/>
								{:else if col.type === 'number'}
									<input 
										type="number" 
										value={row[col.id] ?? ''} 
										onchange={(e) => updateCell(row.id, col.id, e.currentTarget.value === '' ? '' : Number(e.currentTarget.value))}
										placeholder="0"
										readonly={!editable}
									/>
								{:else if col.type === 'date'}
									<input 
										type="date" 
										value={row[col.id] || ''} 
										onchange={(e) => updateCell(row.id, col.id, e.currentTarget.value)}
										readonly={!editable}
									/>
								{:else if col.type === 'status'}
									{@const val = row[col.id]}
									<button 
										class="tag-trigger-btn"
										onclick={(e) => { e.stopPropagation(); activeSelectDropdown = activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id ? null : { rowId: row.id, colId: col.id }; activeColumnMenu = null; }}
										disabled={!editable}
									>
										{#if val}
											{@const style = getTagColor(val)}
											<span class="tag-pill" style="background-color: {style.bg}; color: {style.text}; border: 1px solid {style.text}20;">
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
										class="tag-trigger-btn multi"
										onclick={(e) => { e.stopPropagation(); activeSelectDropdown = activeSelectDropdown?.rowId === row.id && activeSelectDropdown?.colId === col.id ? null : { rowId: row.id, colId: col.id }; activeColumnMenu = null; }}
										disabled={!editable}
									>
										<div class="tag-list">
											{#if vals.length > 0}
												{#each vals as val}
													{@const style = getTagColor(val)}
													<span class="tag-pill" style="background-color: {style.bg}; color: {style.text}; border: 1px solid {style.text}20;">
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
											{#each options[col.id] || [] as option}
												{@const isSel = isOptionSelected(row, col.id, option, isMulti)}
												{@const style = getTagColor(option)}
												<div 
													class="option-item" 
													onclick={() => toggleOptionSelection(row, col.id, option, isMulti)}
													tabindex="0"
													role="button"
													onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleOptionSelection(row, col.id, option, isMulti); } }}
												>
													<span class="tag-pill" style="background-color: {style.bg}; color: {style.text}; border: 1px solid {style.text}20;">
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
													onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(col.id); } }}
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
						{#if editable}
							<td class="col-add-cell"></td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>

<style>
	.db-block-container {
		margin: 1.5rem 0;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		background-color: var(--bg-canvas);
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
	}

	/* Header bar */
	.db-header-bar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 12px;
		border-bottom: 1px solid var(--border-color);
		background-color: color-mix(in srgb, var(--bg-sidebar) 50%, transparent);
	}

	.db-search-wrapper {
		display: flex;
		align-items: center;
		gap: 6px;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 4px 10px;
		width: 240px;
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.02);
	}

	.db-search-wrapper :global(.search-icon) {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.db-search-input {
		font-size: 13px;
		width: 100%;
		color: var(--text-main);
	}

	.db-search-input::placeholder {
		color: var(--text-muted);
		opacity: 0.8;
	}

	.db-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 13px;
		font-weight: 500;
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		background-color: var(--bg-canvas);
		color: var(--text-main);
		transition: all 0.15s ease;
	}

	.db-btn:hover {
		background-color: var(--hover-icon);
		border-color: color-mix(in srgb, var(--border-color) 80%, black);
	}

	.db-btn.primary {
		background-color: var(--accent-color);
		color: white;
		border: none;
	}

	.db-btn.primary:hover {
		opacity: 0.9;
	}

	/* Table Wrapper */
	.db-table-wrapper {
		overflow-x: auto;
		width: 100%;
	}

	.db-table {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
		font-size: 13px;
	}

	/* Table Headers */
	.db-th {
		position: relative;
		font-weight: 500;
		text-align: left;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		background-color: color-mix(in srgb, var(--bg-sidebar) 30%, transparent);
		padding: 0;
		width: 180px;
	}

	.th-content {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 10px;
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

	.col-actions-header {
		width: 40px;
		border-bottom: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		background-color: color-mix(in srgb, var(--bg-sidebar) 30%, transparent);
	}

	.col-add-header {
		border-bottom: 1px solid var(--border-color);
		padding: 0;
		background-color: color-mix(in srgb, var(--bg-sidebar) 20%, transparent);
		width: 120px;
	}

	.col-add-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px;
		width: 100%;
		color: var(--text-muted);
		font-weight: 400;
	}

	.col-add-btn:hover {
		color: var(--text-main);
		background-color: var(--hover-icon);
	}

	/* Popover menus */
	.th-menu-popover {
		position: absolute;
		top: calc(100% + 4px);
		left: 8px;
		z-index: 50;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
		padding: 12px;
		width: 200px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.popover-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.popover-section label {
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

	.select-chevron {
		position: absolute;
		right: 8px;
		color: var(--text-muted);
		pointer-events: none;
		display: inline-flex;
		align-items: center;
	}

	.popover-actions {
		border-top: 1px solid var(--border-color);
		padding-top: 8px;
		display: flex;
	}

	.popover-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		width: 100%;
		padding: 6px 8px;
		border-radius: 4px;
		text-align: left;
	}

	.popover-btn.delete {
		color: var(--error-color);
	}

	.popover-btn.delete:hover {
		background-color: color-mix(in srgb, var(--error-color) 8%, transparent);
	}

	/* Table Cells */
	.db-td {
		position: relative;
		border-bottom: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		padding: 0;
		height: 38px;
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

	.col-actions-cell {
		width: 40px;
		border-bottom: 1px solid var(--border-color);
		border-right: 1px solid var(--border-color);
		text-align: center;
		padding: 0;
	}

	.row-delete-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		padding: 6px;
		border-radius: 4px;
		opacity: 0;
		transition: opacity 0.15s ease, color 0.15s ease, background-color 0.15s ease;
	}

	tr:hover .row-delete-btn {
		opacity: 0.6;
	}

	.row-delete-btn:hover {
		opacity: 1 !important;
		color: var(--error-color);
		background-color: color-mix(in srgb, var(--error-color) 8%, transparent);
	}

	.col-add-cell {
		border-bottom: 1px solid var(--border-color);
		background-color: color-mix(in srgb, var(--bg-sidebar) 5%, transparent);
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
