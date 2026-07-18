<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { 
		Menu, 
		ChevronLeft, 
		Search, 
		Plus, 
		Sun, 
		Moon, 
		Trash2, 
		Download, 
		ChevronRight,
		ChevronDown,
		Trash,
		RotateCcw,
		Edit3
	} from 'lucide-svelte';

	// SvelteKit Props
	let { data, children } = $props();

	// App Layout States
	let isSidebarOpen = $state(true);
	let isDarkMode = $state(false);
	let isMobile = $state(false);
	let isTrashOpen = $state(false);
	
	// Track expanded nodes in the page tree sidebar
	let expandedNodes = $state(new Set<number>());

	// Inline editing title states
	let editingPageId = $state<number | null>(null);
	let editingTitleText = $state('');
	let draggedPageId = $state<number | null>(null);
	let dropTarget = $state<{ id: number; placement: 'before' | 'inside' | 'after' } | null>(null);

	// Active page tracking from route params
	let currentPageId = $derived($page.params.id ? parseInt($page.params.id, 10) : null);

	// Tree structure derived from active database pages
	let pageTree = $derived(buildTree(data.activePages || []));

	function buildTree(flatPages: any[]) {
		const map = new Map();
		const roots: any[] = [];
		
		for (const p of flatPages) {
			map.set(p.id, { ...p, children: [] });
		}
		
		for (const p of flatPages) {
			const mapped = map.get(p.id);
			if (p.parentId === null) {
				roots.push(mapped);
			} else {
				const parent = map.get(p.parentId);
				if (parent) {
					parent.children.push(mapped);
				} else {
					roots.push(mapped);
				}
			}
		}

		const sortNode = (node: any) => {
			node.children.sort((a: any, b: any) => a.position - b.position);
			node.children.forEach(sortNode);
		};

		roots.sort((a, b) => a.position - b.position);
		roots.forEach(sortNode);

		return roots;
	}

	onMount(() => {
		const handleResize = () => {
			isMobile = window.innerWidth < 768;
			if (isMobile) isSidebarOpen = false;
		};
		
		handleResize();
		window.addEventListener('resize', handleResize);

		// Dark Mode Initialization
		if (
			localStorage.theme === 'dark' || 
			(!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches)
		) {
			isDarkMode = true;
			document.documentElement.classList.add('dark');
		} else {
			isDarkMode = false;
			document.documentElement.classList.remove('dark');
		}

		return () => {
			window.removeEventListener('resize', handleResize);
		};
	});

	function toggleSidebar() {
		isSidebarOpen = !isSidebarOpen;
	}

	function toggleTheme() {
		isDarkMode = !isDarkMode;
		if (isDarkMode) {
			document.documentElement.classList.add('dark');
			localStorage.theme = 'dark';
		} else {
			document.documentElement.classList.remove('dark');
			localStorage.theme = 'light';
		}
	}

	function toggleNodeExpand(id: number, e: MouseEvent) {
		e.stopPropagation();
		const next = new Set(expandedNodes);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedNodes = next;
	}

	function startEditingTitle(id: number, currentTitle: string, e: MouseEvent) {
		e.stopPropagation();
		editingPageId = id;
		editingTitleText = currentTitle;
	}

	function cancelEditingTitle() {
		editingPageId = null;
	}

	function isValidDropTarget(targetId: number) {
		if (draggedPageId === null || draggedPageId === targetId) return false;

		let ancestorId: number | null = targetId;
		while (ancestorId !== null) {
			if (ancestorId === draggedPageId) return false;
			const ancestor = data.activePages?.find((page) => page.id === ancestorId);
			ancestorId = ancestor?.parentId ?? null;
		}

		return true;
	}

	function getDropPlacement(event: DragEvent): 'before' | 'inside' | 'after' {
		const row = event.currentTarget as HTMLElement;
		const { top, height } = row.getBoundingClientRect();
		const verticalPosition = event.clientY - top;

		if (verticalPosition < height * 0.25) return 'before';
		if (verticalPosition > height * 0.75) return 'after';
		return 'inside';
	}

	function handleDragStart(event: DragEvent, node: any) {
		if (editingPageId !== null) {
			event.preventDefault();
			return;
		}

		draggedPageId = node.id;
		event.dataTransfer?.setData('text/plain', String(node.id));
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function handleDragOver(event: DragEvent, node: any) {
		if (!isValidDropTarget(node.id)) return;
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
		dropTarget = { id: node.id, placement: getDropPlacement(event) };
	}

	function clearDragState() {
		draggedPageId = null;
		dropTarget = null;
	}

	async function handleDrop(event: DragEvent, node: any) {
		event.preventDefault();
		if (!isValidDropTarget(node.id) || !dropTarget || dropTarget.id !== node.id || draggedPageId === null) {
			clearDragState();
			return;
		}

		const draggedPage = data.activePages?.find((page) => page.id === draggedPageId);
		if (!draggedPage) {
			clearDragState();
			return;
		}

		const placement = dropTarget.placement;
		const targetSiblings = (data.activePages || [])
			.filter((page) => page.parentId === node.parentId && page.id !== draggedPage.id)
			.sort((a, b) => a.position - b.position);
		const targetIndex = targetSiblings.findIndex((page) => page.id === node.id);
		const parentId = placement === 'inside' ? node.id : node.parentId;
		const position = placement === 'inside'
			? (data.activePages || []).filter((page) => page.parentId === node.id && page.id !== draggedPage.id).length
			: targetIndex + (placement === 'after' ? 1 : 0);

		try {
			const formData = new FormData();
			formData.set('id', String(draggedPage.id));
			formData.set('parentId', parentId === null ? 'null' : String(parentId));
			formData.set('position', String(position));
			const response = await fetch('/?/move', { method: 'POST', body: formData });
			if (response.ok) {
				if (placement === 'inside') {
					expandedNodes = new Set(expandedNodes).add(node.id);
				}
				await invalidateAll();
			}
		} finally {
			clearDragState();
		}
	}
</script>

<div class="app-container" class:sidebar-closed={!isSidebarOpen} class:mobile={isMobile}>
	<!-- Sidebar -->
	<aside class="sidebar">
		<div class="sidebar-header">
			<div class="user-workspace">
				<span class="avatar">Q</span>
				<span class="workspace-name">Quiet Workspace</span>
			</div>
			<button class="icon-btn toggle-sidebar-btn" onclick={toggleSidebar} title="Close sidebar">
				<ChevronLeft size={16} />
			</button>
		</div>

		<!-- Action items -->
		<div class="sidebar-actions">
			<button class="action-item">
				<Search size={14} />
				<span>Search</span>
			</button>
			<form method="POST" action="/?/create" use:enhance>
				<input type="hidden" name="parentId" value="null" />
				<input type="hidden" name="title" value="Untitled" />
				<button type="submit" class="action-item add-page-action-btn">
					<Plus size={14} />
					<span>New Page</span>
				</button>
			</form>
		</div>

		<!-- Page list -->
		<div class="sidebar-nav">
			<div class="section-title">Private</div>
			
			<div class="pages-list">
				{#each pageTree as pageNode}
					{@render renderNode(pageNode)}
				{/each}
				
				{#if pageTree.length === 0}
					<div class="empty-tree-message">No pages created yet. Click "New Page" to start.</div>
				{/if}
			</div>
		</div>

		<!-- Trash bin panel overlay inside sidebar -->
		{#if isTrashOpen}
			<div class="trash-panel">
				<div class="trash-panel-header">
					<span>Trash Bin</span>
					<div class="trash-header-actions">
						<form method="POST" action="/?/emptyTrash" use:enhance>
							<button type="submit" class="empty-trash-btn" title="Empty Trash">Empty</button>
						</form>
						<button class="close-trash-btn" onclick={() => isTrashOpen = false}>✕</button>
					</div>
				</div>
				<div class="trash-list">
					{#each data.trashPages || [] as trashPage}
						<div class="trash-item">
							<span class="trash-item-emoji">{trashPage.icon || '📄'}</span>
							<span class="trash-item-title" title={trashPage.title}>{trashPage.title}</span>
							<div class="trash-item-actions">
								<form method="POST" action="/?/restore" use:enhance>
									<input type="hidden" name="id" value={trashPage.id} />
									<button type="submit" class="trash-action-btn" title="Restore Page">
										<RotateCcw size={12} />
									</button>
								</form>
								<form method="POST" action="/?/delete" use:enhance>
									<input type="hidden" name="id" value={trashPage.id} />
									<button type="submit" class="trash-action-btn delete-perm" title="Delete permanently">
										<Trash size={12} />
									</button>
								</form>
							</div>
						</div>
					{:else}
						<div class="empty-trash-message">Trash is empty</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Trash & Export -->
		<div class="sidebar-footer">
			<button class="footer-item" onclick={() => isTrashOpen = !isTrashOpen}>
				<Trash2 size={14} />
				<span>Trash</span>
				{#if data.trashPages && data.trashPages.length > 0}
					<span class="trash-badge">{data.trashPages.length}</span>
				{/if}
			</button>
			<button class="footer-item">
				<Download size={14} />
				<span>Export</span>
			</button>
		</div>
	</aside>

	<!-- Mobile Overlay -->
	{#if isMobile && isSidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="mobile-overlay" onclick={toggleSidebar}></div>
	{/if}

	<!-- Main Canvas Area -->
	<main class="main-content">
		<!-- Header -->
		<header class="header">
			<div class="left-controls">
				{#if !isSidebarOpen || isMobile}
					<button class="icon-btn menu-btn" onclick={toggleSidebar} title="Open sidebar">
						<Menu size={16} />
					</button>
				{/if}
				<div class="breadcrumbs">
					<span class="breadcrumb-item">Quiet Pages</span>
					<span class="breadcrumb-separator">/</span>
					<span class="breadcrumb-item active">
						{#if currentPageId}
							{@const activePage = data.activePages?.find(p => p.id === currentPageId)}
							{activePage ? (activePage.icon ? activePage.icon + ' ' : '') + activePage.title : 'Loading...'}
						{:else}
							Workspace
						{/if}
					</span>
				</div>
			</div>

			<div class="right-controls">
				<button class="icon-btn theme-btn" onclick={toggleTheme} title="Toggle theme">
					{#if isDarkMode}
						<Sun size={16} />
					{:else}
						<Moon size={16} />
					{/if}
				</button>
			</div>
		</header>

		<!-- Canvas Area -->
		<div class="canvas-wrapper">
			<div class="canvas">
				{@render children()}
			</div>
		</div>
	</main>
</div>

<!-- Snippet: Recursive Node rendering -->
{#snippet renderNode(node: any)}
	<div class="page-tree-node">
		<!-- Page item row container -->
		<div 
			class="page-item-row" 
			role="treeitem"
			aria-selected={currentPageId === node.id}
			tabindex="-1"
			class:active={currentPageId === node.id}
			class:dragging={draggedPageId === node.id}
			class:drop-before={dropTarget?.id === node.id && dropTarget?.placement === 'before'}
			class:drop-inside={dropTarget?.id === node.id && dropTarget?.placement === 'inside'}
			class:drop-after={dropTarget?.id === node.id && dropTarget?.placement === 'after'}
			draggable={editingPageId !== node.id}
			ondragstart={(event) => handleDragStart(event, node)}
			ondragover={(event) => handleDragOver(event, node)}
			ondrop={(event) => handleDrop(event, node)}
			ondragend={clearDragState}
		>
			<!-- Overlapping Emoji / Chevron symbol slot -->
			<div class="page-symbol-slot" class:has-children={node.children && node.children.length > 0}>
				{#if node.children && node.children.length > 0}
					<button 
						class="disclosure-btn" 
						onclick={(e) => toggleNodeExpand(node.id, e)}
						aria-label={expandedNodes.has(node.id) ? 'Collapse' : 'Expand'}
					>
						{#if expandedNodes.has(node.id)}
							<ChevronDown size={12} />
						{:else}
							<ChevronRight size={12} />
						{/if}
					</button>
					<span class="page-emoji">{node.icon || '📄'}</span>
				{:else}
					<span class="page-emoji">{node.icon || '📄'}</span>
				{/if}
			</div>

			{#if editingPageId === node.id}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<form 
					method="POST" 
					action="/?/rename" 
					use:enhance={() => {
						editingPageId = null;
					}}
					class="inline-rename-form"
					onclick={(e) => e.stopPropagation()}
				>
					<input type="hidden" name="id" value={node.id} />
					<input 
						type="text" 
						name="title" 
						bind:value={editingTitleText} 
						onblur={(e) => {
							if (editingTitleText.trim() !== '' && editingTitleText !== node.title) {
								e.currentTarget.form?.requestSubmit();
							} else {
								cancelEditingTitle();
							}
						}}
						onkeydown={(e) => e.key === 'Escape' && cancelEditingTitle()}
						class="inline-rename-input"
						use:focusOnMount
					/>
				</form>
			{:else}
				<!-- Clickable link containing text title -->
				<a href="/{node.id}" class="page-item-link">
					<span class="page-title">{node.title}</span>
				</a>
			{/if}

			<!-- Gutter Actions (Hover states) -->
			<div class="page-actions-gutter">
				<form method="POST" action="/?/create" use:enhance>
					<input type="hidden" name="parentId" value={node.id} />
					<input type="hidden" name="title" value="Untitled" />
					<button type="submit" class="gutter-action-btn" title="Add child page" onclick={(e) => e.stopPropagation()}>
						<Plus size={12} />
					</button>
				</form>
				<button class="gutter-action-btn" title="Rename inline" onclick={(e) => startEditingTitle(node.id, node.title, e)}>
					<Edit3 size={12} />
				</button>
				<form method="POST" action="/?/trash" use:enhance>
					<input type="hidden" name="id" value={node.id} />
					<button type="submit" class="gutter-action-btn hover-trash" title="Move to trash">
						<Trash size={12} />
					</button>
				</form>
			</div>
		</div>

		<!-- Recursive Child Rendering -->
		{#if node.children && node.children.length > 0 && expandedNodes.has(node.id)}
			<div class="page-children">
				{#each node.children as child}
					{@render renderNode(child)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

<script module>
	// Custom action to focus renaming inputs immediately on mount
	export function focusOnMount(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
</script>

<style>
	/* Sidebar Custom Additions */
	.add-page-action-btn {
		justify-content: flex-start;
		font-weight: 500;
	}

	.empty-tree-message {
		font-size: 13px;
		color: var(--text-muted);
		padding: 16px 12px;
		text-align: center;
		line-height: 1.4;
	}

	/* Gutter Hover actions on Page Item */
	.page-actions-gutter {
		display: flex;
		gap: 2px;
		margin-left: auto;
		opacity: 0;
		transition: opacity var(--transition-speed);
		z-index: 2;
	}

	.page-item-row:hover .page-actions-gutter {
		opacity: 1;
	}

	.page-item-row[draggable='true'] {
		cursor: grab;
	}

	.page-item-row.dragging {
		opacity: 0.45;
		cursor: grabbing;
	}

	.page-item-row.drop-before::before,
	.page-item-row.drop-after::after {
		content: '';
		position: absolute;
		left: 4px;
		right: 4px;
		height: 2px;
		background: var(--accent-color);
		border-radius: 2px;
	}

	.page-item-row.drop-before::before {
		top: -2px;
	}

	.page-item-row.drop-after::after {
		bottom: -2px;
	}

	.page-item-row.drop-inside {
		background: color-mix(in srgb, var(--accent-color) 16%, var(--hover-sidebar));
		outline: 1px solid var(--accent-color);
	}

	.gutter-action-btn {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		transition: background var(--transition-speed), color var(--transition-speed);
	}

	.gutter-action-btn:hover {
		background-color: var(--hover-icon);
		color: var(--text-main);
	}

	.gutter-action-btn.hover-trash:hover {
		color: var(--error-color);
	}

	/* Inline rename formatting */
	.inline-rename-form {
		flex: 1;
		display: flex;
		align-items: center;
		z-index: 2;
	}

	.inline-rename-input {
		width: 100%;
		font-size: 14px;
		background: var(--bg-canvas);
		border: 1px solid var(--accent-color);
		border-radius: 3px;
		padding: 1px 4px;
		color: var(--text-main);
	}

	/* Trash Panel Overlay inside Sidebar */
	.trash-panel {
		position: absolute;
		bottom: var(--header-height);
		left: 0;
		width: 100%;
		max-height: 240px;
		background: var(--bg-sidebar);
		border-top: 1px solid var(--border-color);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
		display: flex;
		flex-direction: column;
		z-index: 20;
	}

	.trash-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted);
		border-bottom: 1px solid var(--border-color);
		background-color: var(--hover-sidebar);
	}

	.trash-header-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.empty-trash-btn {
		font-size: 11px;
		color: var(--error-color);
		font-weight: 600;
		text-transform: uppercase;
	}

	.close-trash-btn {
		font-size: 14px;
		color: var(--text-muted);
	}

	.trash-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.trash-item {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		border-radius: 3px;
		font-size: 13px;
		color: var(--text-main);
	}

	.trash-item:hover {
		background-color: var(--hover-sidebar);
	}

	.trash-item-title {
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.trash-item-actions {
		display: flex;
		gap: 2px;
	}

	.trash-action-btn {
		width: 20px;
		height: 20px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		transition: background var(--transition-speed);
	}

	.trash-action-btn:hover {
		background-color: var(--hover-icon);
		color: var(--text-main);
	}

	.trash-action-btn.delete-perm:hover {
		color: var(--error-color);
	}

	.empty-trash-message {
		font-size: 12px;
		color: var(--text-muted);
		text-align: center;
		padding: 24px;
	}

	.trash-badge {
		background-color: var(--border-color);
		color: var(--text-muted);
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 10px;
		margin-left: auto;
		font-weight: 600;
	}
</style>
