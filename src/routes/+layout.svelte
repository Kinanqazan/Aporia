<script lang="ts">
	import '../app.css';
	import PageIcon from '$lib/components/PageIcon.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { enhance } from '$app/forms';
	import { invalidateAll, goto, afterNavigate } from '$app/navigation';
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
		Edit3,
		Unlock,
		Lock,
		FileDown,
		MoreHorizontal,
		Settings,
		FileUp
	} from 'lucide-svelte';
	import type { PageNode } from '$lib/server/pages';

	// SvelteKit Props
	let { data, children } = $props();

	// App Layout States
	let isSidebarOpen = $state(true);
	let isDarkMode = $state(false);
	let isMobile = $state(false);
	let isTrashOpen = $state(false);
	let isSettingsOpen = $state(false);
	let isCleanupInProgress = $state(false);
	let cleanupMessage = $state('');
	let notionImportInput = $state<HTMLInputElement | null>(null);
	let notionImportFile = $state<File | null>(null);
	let notionImportPreview = $state<{ pageCount: number; imageCount: number; warnings: string[] } | null>(null);
	let isNotionPreviewInProgress = $state(false);
	let isNotionImportInProgress = $state(false);
	let notionImportMessage = $state('');
	function initialSidebarWidth() {
		return data.sidebarWidth ?? 240;
	}

	function initialSectionTitle() {
		return data.sectionTitle ?? 'Private';
	}

	let sidebarWidth = $state(initialSidebarWidth());
	let isResizing = $state(false);
	
	// Track expanded nodes in the page tree sidebar
	let expandedNodes = $state(new Set<string>());
	const expandedNodesStorageKey = 'aporia-expanded-sidebar-pages';

	// Search States
	let isSearchOpen = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let searchFocusedIndex = $state(0);
	let sidebarSearchInputEl = $state<HTMLInputElement | null>(null);
	let searchContainerEl = $state<HTMLDivElement | null>(null);

	// Inline editing title states
	let editingPageId = $state<string | null>(null);
	let editingTitleText = $state('');
	let draggedPageId = $state<string | null>(null);
	let dropTarget = $state<{ id: string; placement: 'before' | 'inside' | 'after' } | null>(null);
	let isLockRequestInFlight = $state(false);
	
	// Section Title States
	let sectionTitle = $state(initialSectionTitle());
	let isEditingSectionTitle = $state(false);
	
	// Dropdown menu state
	let openMenuPageId = $state<string | null>(null);

	// Active page tracking from route params
	let currentPageId = $derived($page.params.id || null);

	// Breadcrumb path tracking
	let breadcrumbs = $derived.by(() => {
		if (!currentPageId || !data.activePages) return [];
		const path: any[] = [];
		const pagesMap = new Map(data.activePages.map((p) => [p.id, p]));
		let current = pagesMap.get(currentPageId);
		while (current) {
			path.unshift(current);
			current = current.parentId ? pagesMap.get(current.parentId) : undefined;
		}
		return path;
	});

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
			const nextIsMobile = window.innerWidth < 768;

			// Opening the on-screen keyboard in an installed PWA can emit a resize
			// event without changing the responsive breakpoint. Do not close the
			// drawer for those viewport resizes after it has been opened.
			if (nextIsMobile !== isMobile) {
				isMobile = nextIsMobile;
				if (nextIsMobile) isSidebarOpen = false;
			}
		};
		
		handleResize();
		window.addEventListener('resize', handleResize);

		const handleClickOutside = (e: MouseEvent) => {
			if (isSearchOpen && searchContainerEl && !searchContainerEl.contains(e.target as Node)) {
				isSearchOpen = false;
			}
			if (openMenuPageId) {
				openMenuPageId = null;
			}
		};
		window.addEventListener('click', handleClickOutside);

		// Sidebar width cookie migration & restoration
		if (!document.cookie.includes('sidebar-width=')) {
			const savedWidth = localStorage.getItem('sidebar-width');
			if (savedWidth) {
				sidebarWidth = parseInt(savedWidth, 10);
				document.cookie = `sidebar-width=${savedWidth}; path=/; max-age=31536000; SameSite=Lax`;
			}
		}

		const savedExpandedNodes = localStorage.getItem(expandedNodesStorageKey);
		if (savedExpandedNodes) {
			try {
				const savedIds = JSON.parse(savedExpandedNodes);
				if (Array.isArray(savedIds)) {
					expandedNodes = new Set(savedIds.filter((id): id is string => typeof id === 'string'));
				}
			} catch {
				localStorage.removeItem(expandedNodesStorageKey);
			}
		}

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
			window.removeEventListener('click', handleClickOutside);
		};
	});

	afterNavigate(() => {
		isSearchOpen = false;
		if (isMobile) {
			isSidebarOpen = false;
		}
	});

	async function handleSearchInput() {
		searchFocusedIndex = 0;
		if (!searchQuery.trim()) {
			searchResults = [];
			return;
		}
		try {
			const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}`);
			const data = await res.json();
			searchResults = data.results || [];
		} catch (err) {
			console.error(err);
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (searchResults.length > 0) {
				searchFocusedIndex = (searchFocusedIndex + 1) % searchResults.length;
			}
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (searchResults.length > 0) {
				searchFocusedIndex = (searchFocusedIndex - 1 + searchResults.length) % searchResults.length;
			}
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (searchResults[searchFocusedIndex]) {
				selectSearchResult(searchResults[searchFocusedIndex]);
			}
		} else if (e.key === 'Escape') {
			isSearchOpen = false;
		}
	}

	function selectSearchResult(result: any) {
		isSearchOpen = false;
		goto(`/${result.id}`);
	}

	async function togglePageLock() {
		if (!currentPageId || isLockRequestInFlight) return;
		const activePage = data.activePages?.find((page) => page.id === currentPageId);
		if (!activePage) return;

		isLockRequestInFlight = true;
		try {
			const response = await fetch(`/api/pages/${currentPageId}/lock`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isLocked: activePage.isLocked !== 1 })
			});
			if (response.ok) await invalidateAll();
		} catch (err) {
			console.error('Lock update failed:', err);
		} finally {
			isLockRequestInFlight = false;
		}
	}

	function startResizing(e: MouseEvent) {
		e.preventDefault();
		isResizing = true;
		document.body.style.userSelect = 'none';
		document.body.style.cursor = 'col-resize';
		
		const handleMouseMove = (moveEvent: MouseEvent) => {
			sidebarWidth = Math.max(160, Math.min(480, moveEvent.clientX));
		};
		const handleMouseUp = () => {
			isResizing = false;
			document.body.style.userSelect = '';
			document.body.style.cursor = '';
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('mouseup', handleMouseUp);
			localStorage.setItem('sidebar-width', String(sidebarWidth));
			document.cookie = `sidebar-width=${sidebarWidth}; path=/; max-age=31536000; SameSite=Lax`;
		};
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('mouseup', handleMouseUp);
	}

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

	function toggleNodeExpand(id: string, e: MouseEvent) {
		e.stopPropagation();
		const next = new Set(expandedNodes);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		expandedNodes = next;
		localStorage.setItem(expandedNodesStorageKey, JSON.stringify([...next]));
	}

	function isCurrentPageInSubtree(rootId: string): boolean {
		let candidateId = currentPageId;
		const pagesById = new Map((data.activePages || []).map((page) => [page.id, page]));
		while (candidateId) {
			if (candidateId === rootId) return true;
			candidateId = pagesById.get(candidateId)?.parentId ?? null;
		}
		return false;
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function cleanUnusedUploads() {
		if (isCleanupInProgress) return;
		if (!window.confirm('Delete uploads that are not used by any page? This cannot be undone.')) return;

		isCleanupInProgress = true;
		cleanupMessage = '';
		try {
			const response = await fetch('/api/assets/cleanup', { method: 'POST' });
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || 'Unable to clean uploads');
			cleanupMessage = result.removed === 0
				? 'No unused uploads found.'
				: `Removed ${result.removed} upload${result.removed === 1 ? '' : 's'} (${formatBytes(result.bytesFreed)}).`;
		} catch (error) {
			cleanupMessage = error instanceof Error ? error.message : 'Unable to clean uploads';
		} finally {
			isCleanupInProgress = false;
		}
	}

	async function previewNotionImport(file: File) {
		isNotionPreviewInProgress = true;
		notionImportPreview = null;
		notionImportMessage = '';
		try {
			const formData = new FormData();
			formData.set('archive', file);
			const response = await fetch('/api/import/notion/preview', { method: 'POST', body: formData });
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || 'Unable to read the Notion export');
			notionImportPreview = result.preview;
		} catch (error) {
			notionImportFile = null;
			notionImportMessage = error instanceof Error ? error.message : 'Unable to read the Notion export';
		} finally {
			isNotionPreviewInProgress = false;
		}
	}

	function selectNotionImport(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		notionImportFile = file;
		void previewNotionImport(file);
	}

	async function applyNotionImport() {
		if (!notionImportFile || !notionImportPreview || isNotionImportInProgress) return;
		if (!window.confirm(`Import ${notionImportPreview.pageCount} page${notionImportPreview.pageCount === 1 ? '' : 's'} from this Notion export?`)) return;

		isNotionImportInProgress = true;
		notionImportMessage = '';
		try {
			const formData = new FormData();
			formData.set('archive', notionImportFile);
			const response = await fetch('/api/import/notion/apply', { method: 'POST', body: formData });
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || 'Unable to import the Notion export');
			notionImportMessage = `Imported ${result.result.pageCount} page${result.result.pageCount === 1 ? '' : 's'} into “${result.result.rootTitle}”.`;
			notionImportFile = null;
			notionImportPreview = null;
			if (notionImportInput) notionImportInput.value = '';
			await invalidateAll();
		} catch (error) {
			notionImportMessage = error instanceof Error ? error.message : 'Unable to import the Notion export';
		} finally {
			isNotionImportInProgress = false;
		}
	}

	function startEditingTitle(id: string, currentTitle: string, e: MouseEvent) {
		e.stopPropagation();
		editingPageId = id;
		editingTitleText = currentTitle;
	}

	function cancelEditingTitle() {
		editingPageId = null;
	}

	function isValidDropTarget(targetId: string) {
		if (draggedPageId === null || draggedPageId === targetId) return false;

		let ancestorId: string | null = targetId;
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
					const nextExpandedNodes = new Set(expandedNodes).add(node.id);
					expandedNodes = nextExpandedNodes;
					localStorage.setItem(expandedNodesStorageKey, JSON.stringify([...nextExpandedNodes]));
				}
				await invalidateAll();
			}
		} finally {
			clearDragState();
		}
	}

	// Touch swipe gesture handlers for mobile sidebar opening/closing
	let touchStartX = 0;
	let touchStartY = 0;
	let touchEndX = 0;
	let touchEndY = 0;

	function handleTouchStart(e: TouchEvent) {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
		touchEndX = touchStartX;
		touchEndY = touchStartY;
	}

	function handleTouchMove(e: TouchEvent) {
		touchEndX = e.touches[0].clientX;
		touchEndY = e.touches[0].clientY;
	}

	function handleTouchEnd() {
		const diffX = touchEndX - touchStartX;
		const diffY = touchEndY - touchStartY;

		// Ensure swipe is horizontal and exceeds threshold
		if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 60) {
			if (isMobile) {
				if (diffX > 0 && !isSidebarOpen && touchStartX > 30) {
					isSidebarOpen = true;
				} else if (diffX < 0 && isSidebarOpen) {
					isSidebarOpen = false;
				}
			}
		}
	}
</script>

<svelte:head>
	<meta name="theme-color" content={isDarkMode ? '#191919' : '#ffffff'} />
</svelte:head>

	<svelte:window
		ontouchstart={handleTouchStart}
		ontouchmove={handleTouchMove}
		ontouchend={handleTouchEnd}
	/>

	<div
	class="app-container" 
	class:sidebar-closed={!isSidebarOpen} 
	class:mobile={isMobile} 
	style="--sidebar-width: {sidebarWidth}px;"
>
	<!-- Sidebar -->
	<aside class="sidebar">
		<div class="sidebar-header">
			<div class="user-workspace">
				<img src="/Wolf.svg" alt="Aporia Logo" class="workspace-logo" />
				<span class="workspace-name">Aporia</span>
			</div>
			<button class="icon-btn toggle-sidebar-btn" onclick={toggleSidebar} title="Close sidebar">
				<ChevronLeft size={16} />
			</button>
		</div>

		<!-- Action items -->
		<div class="sidebar-actions">
			<div class="sidebar-search-container" bind:this={searchContainerEl}>
				<div class="sidebar-search-input-wrapper">
					<Search size={16} class="sidebar-search-icon" />
					<input
						bind:this={sidebarSearchInputEl}
						type="text"
						placeholder="Search..."
						bind:value={searchQuery}
						oninput={handleSearchInput}
						onkeydown={handleSearchKeydown}
						onfocus={() => isSearchOpen = true}
						onclick={(e) => e.stopPropagation()}
					/>
					{#if searchQuery}
						<button type="button" class="clear-search-btn" onclick={() => { searchQuery = ''; searchResults = []; }}>✕</button>
					{/if}
				</div>
				
				{#if isSearchOpen && searchResults.length > 0}
					<div class="sidebar-search-results">
						{#each searchResults as result, idx}
							<a
								href="/{result.id}?highlight={encodeURIComponent(searchQuery)}"
								class="sidebar-search-result-item"
								class:focused={idx === searchFocusedIndex}
								onclick={() => { isSearchOpen = false; }}
							>
								<span class="sidebar-result-icon">
									<PageIcon icon={result.icon} size={14} />
								</span>
								<div class="sidebar-result-body">
									<span class="sidebar-result-title">{result.title}</span>
									{#if result.snippet}
										<span class="sidebar-result-snippet">{@html result.snippet}</span>
									{/if}
								</div>
							</a>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Page list -->
		<div class="sidebar-nav">
			<div class="section-header">
				{#if isEditingSectionTitle}
					<input
						type="text"
						class="section-title-input"
						bind:value={sectionTitle}
						onblur={async () => {
							isEditingSectionTitle = false;
							if (!sectionTitle.trim()) sectionTitle = 'Private';
							document.cookie = `sidebar-section-title=${encodeURIComponent(sectionTitle)}; path=/; max-age=31536000; SameSite=Lax`;
							await fetch('/api/settings', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json' },
								body: JSON.stringify({ key: 'sidebar-section-title', value: sectionTitle })
							});
						}}
						onkeydown={async (e) => {
							if (e.key === 'Enter') {
								isEditingSectionTitle = false;
								if (!sectionTitle.trim()) sectionTitle = 'Private';
								document.cookie = `sidebar-section-title=${encodeURIComponent(sectionTitle)}; path=/; max-age=31536000; SameSite=Lax`;
								await fetch('/api/settings', {
									method: 'POST',
									headers: { 'Content-Type': 'application/json' },
									body: JSON.stringify({ key: 'sidebar-section-title', value: sectionTitle })
								});
							}
						}}
						use:focusOnMount
					/>
				{:else}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div 
						class="section-title editable" 
						onclick={() => isEditingSectionTitle = true} 
						title="Click to edit section name"
					>
						{sectionTitle}
					</div>
				{/if}
				<form method="POST" action="/?/create" use:enhance style="display: inline-flex;">
					<input type="hidden" name="parentId" value="null" />
					<input type="hidden" name="title" value="Untitled" />
					<button type="submit" class="add-section-btn" title="Create new page">
						<Plus size={13} />
					</button>
				</form>
			</div>
			
			<div class="pages-list">
				{#each pageTree as pageNode}
					{@render renderNode(pageNode)}
				{/each}
				
				{#if pageTree.length === 0}
					<div class="empty-tree-message">No pages created yet. Click the "+" to start.</div>
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
							<span class="trash-item-emoji">
								<PageIcon icon={trashPage.icon} size={14} />
							</span>
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
			<div class="footer-row">
				<button
					class="footer-icon-btn"
					onclick={() => {
						isTrashOpen = !isTrashOpen;
						isSettingsOpen = false;
					}}
					title="Trash Bin"
				>
					<Trash2 size={18} />
					{#if data.trashPages && data.trashPages.length > 0}
						<span class="trash-badge-bubble">{data.trashPages.length}</span>
					{/if}
				</button>
				<button
					class="footer-icon-btn"
					onclick={() => {
						isSettingsOpen = !isSettingsOpen;
						isTrashOpen = false;
					}}
					title="Settings"
					aria-label="Open settings"
				>
					<Settings size={18} />
				</button>
			</div>
		</div>

		{#if isSettingsOpen}
			<div class="settings-panel" aria-label="Settings">
				<div class="settings-panel-header">
					<span>Settings</span>
					<button type="button" class="close-settings-btn" onclick={() => isSettingsOpen = false} aria-label="Close settings">×</button>
				</div>

				<div class="settings-section">
					<span class="settings-section-title">Appearance</span>
					<button class="settings-action" onclick={toggleTheme}>
						{#if isDarkMode}
							<Sun size={16} />
							<span>Use light mode</span>
						{:else}
							<Moon size={16} />
							<span>Use dark mode</span>
						{/if}
					</button>
				</div>

				<div class="settings-section">
					<span class="settings-section-title">Export</span>
					{#if currentPageId}
						<a href="/api/export?id={currentPageId}" download class="settings-action" onclick={() => isSettingsOpen = false}>
							<FileDown size={16} />
							<span>Export current page</span>
						</a>
					{/if}
					<a href="/api/export?all=true" download class="settings-action" onclick={() => isSettingsOpen = false}>
						<Download size={16} />
						<span>Export workspace</span>
					</a>
				</div>

				<div class="settings-section">
					<span class="settings-section-title">Storage</span>
					<button class="settings-action" disabled={isCleanupInProgress} onclick={cleanUnusedUploads}>
						<Trash2 size={16} />
						<span>{isCleanupInProgress ? 'Cleaning unused uploads…' : 'Clean unused uploads'}</span>
					</button>
					<p class="settings-help">Deletes local uploads not used by any active or trashed page.</p>
					{#if cleanupMessage}
						<p class="settings-cleanup-message">{cleanupMessage}</p>
					{/if}
				</div>

				<div class="settings-section">
					<span class="settings-section-title">Import</span>
					<input
						bind:this={notionImportInput}
						class="notion-import-input"
						type="file"
						accept=".zip,application/zip,application/x-zip-compressed"
						onchange={selectNotionImport}
					/>
					<button class="settings-action" disabled={isNotionPreviewInProgress || isNotionImportInProgress} onclick={() => notionImportInput?.click()}>
						<FileUp size={16} />
						<span>{isNotionPreviewInProgress ? 'Reading Notion export…' : 'Import from Notion'}</span>
					</button>
					<p class="settings-help">Choose a Notion HTML export ZIP. CSV databases are not imported yet.</p>
					{#if notionImportPreview}
						<div class="notion-import-preview">
							<span>{notionImportPreview.pageCount} page{notionImportPreview.pageCount === 1 ? '' : 's'} · {notionImportPreview.imageCount} image{notionImportPreview.imageCount === 1 ? '' : 's'}</span>
							{#each notionImportPreview.warnings as warning}
								<span class="notion-import-warning">{warning}</span>
							{/each}
							<button class="settings-action notion-import-confirm" disabled={isNotionImportInProgress} onclick={applyNotionImport}>
								<FileUp size={16} />
								<span>{isNotionImportInProgress ? 'Importing…' : 'Import pages'}</span>
							</button>
						</div>
					{/if}
					{#if notionImportMessage}
						<p class="settings-cleanup-message">{notionImportMessage}</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Resizer handle -->
		{#if !isMobile}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div 
				class="sidebar-resizer" 
				class:resizing={isResizing}
				onmousedown={startResizing}
			></div>
		{/if}
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
						<Menu size={isMobile ? 22 : 16} />
					</button>
				{/if}
				{#if isMobile && currentPageId}
					{@const activePage = data.activePages?.find(p => p.id === currentPageId)}
					{#if activePage}
						<button
							class="icon-btn mobile-lock-btn"
							type="button"
							onclick={togglePageLock}
							disabled={isLockRequestInFlight}
							title={activePage.isLocked ? 'Unlock page' : 'Lock page'}
							aria-label={activePage.isLocked ? 'Unlock page' : 'Lock page'}
						>
							{#if activePage.isLocked}<Lock size={isMobile ? 22 : 20} />{:else}<Unlock size={isMobile ? 22 : 20} />{/if}
						</button>
					{/if}
				{/if}
				{#if !isMobile}
					<div class="breadcrumbs">
						<span class="breadcrumb-item">Aporia</span>
						{#if currentPageId}
							{#each breadcrumbs as crumb, i}
								<span class="breadcrumb-separator">/</span>
								{#if i === breadcrumbs.length - 1}
									<span class="breadcrumb-item active">
										<span style="display: inline-flex; align-items: center; margin-right: 6px; vertical-align: middle;">
											<PageIcon icon={crumb.icon} size={14} />
										</span>
										<span>{crumb.title || 'Untitled'}</span>
										<button
											class="breadcrumb-lock-btn"
											type="button"
											onclick={togglePageLock}
											disabled={isLockRequestInFlight}
											title={crumb.isLocked ? 'Unlock page' : 'Lock page'}
											aria-label={crumb.isLocked ? 'Unlock page' : 'Lock page'}
										>
											{#if crumb.isLocked}<Lock size={13} />{:else}<Unlock size={13} />{/if}
										</button>
									</span>
								{:else}
									<a href="/{crumb.id}" class="breadcrumb-item link">
										<span style="display: inline-flex; align-items: center; margin-right: 4px; vertical-align: middle;">
											<PageIcon icon={crumb.icon} size={12} />
										</span>
										<span>{crumb.title || 'Untitled'}</span>
									</a>
								{/if}
							{/each}
						{:else}
							<span class="breadcrumb-separator">/</span>
							<span class="breadcrumb-item active">Workspace</span>
						{/if}
					</div>
				{/if}
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
{#snippet renderNode(node: PageNode & { children?: any[] })}
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
					<span class="page-emoji">
						<PageIcon icon={node.icon} size={16} />
					</span>
				{:else}
					<span class="page-emoji">
						<PageIcon icon={node.icon} size={16} />
					</span>
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
			<div class="page-actions-gutter" class:menu-open={openMenuPageId === node.id}>
				<button class="gutter-action-btn" title="Options" onclick={(e) => { e.stopPropagation(); openMenuPageId = openMenuPageId === node.id ? null : node.id; }}>
					<MoreHorizontal size={isMobile ? 18 : 14} />
				</button>
				
				{#if openMenuPageId === node.id}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="page-options-dropdown" onclick={(e) => e.stopPropagation()}>
						<form method="POST" action="/?/create" use:enhance={() => { openMenuPageId = null; }}>
							<input type="hidden" name="parentId" value={node.id} />
							<input type="hidden" name="title" value="Untitled" />
							<button type="submit" class="dropdown-action-btn" title="Add child page">
								<Plus size={isMobile ? 18 : 14} /> <span>Add subpage</span>
							</button>
						</form>
						<button class="dropdown-action-btn" title="Rename inline" onclick={(e) => { openMenuPageId = null; startEditingTitle(node.id, node.title, e); }}>
							<Edit3 size={isMobile ? 18 : 14} /> <span>Rename</span>
						</button>
						<form method="POST" action="/?/trash" use:enhance={() => { openMenuPageId = null; }}>
							<input type="hidden" name="id" value={node.id} />
							{#if isCurrentPageInSubtree(node.id)}
								<input type="hidden" name="returnToWorkspace" value="true" />
							{/if}
							<button type="submit" class="dropdown-action-btn hover-trash" title="Move to trash">
								<Trash size={isMobile ? 18 : 14} /> <span>Delete</span>
							</button>
						</form>
					</div>
				{/if}
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
	.breadcrumb-lock-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		margin-left: 2px;
		border-radius: 4px;
		color: var(--text-muted);
		vertical-align: middle;
		transition: background var(--transition-speed), color var(--transition-speed);
	}

	.breadcrumb-lock-btn:hover {
		background: var(--hover-icon);
		color: var(--text-main);
	}

	.breadcrumb-lock-btn:disabled {
		cursor: wait;
		opacity: 0.55;
	}

	/* Sidebar Custom Additions */

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
		position: relative;
	}

	.page-item-row:hover .page-actions-gutter,
	.page-actions-gutter.menu-open {
		opacity: 1;
	}

	:global(.mobile) .page-actions-gutter {
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

	:global(.mobile) .gutter-action-btn {
		width: 32px;
		height: 32px;
		border-radius: 5px;
	}

	/* Page Options Dropdown */
	.page-options-dropdown {
		position: absolute;
		right: 28px;
		top: 0;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 4px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		z-index: 50;
		min-width: 140px;
	}
	
	.dropdown-action-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border: none;
		background: transparent;
		color: var(--text-main);
		font-size: 13px;
		border-radius: 4px;
		cursor: pointer;
		text-align: left;
		transition: background var(--transition-speed), color var(--transition-speed);
	}
	
	.dropdown-action-btn:hover {
		background-color: var(--hover-sidebar);
	}
	
	.dropdown-action-btn.hover-trash:hover {
		background-color: var(--bg-red);
		color: var(--error-color);
	}

	:global(.mobile) .page-options-dropdown {
		min-width: 190px;
		padding: 6px;
		gap: 3px;
	}

	:global(.mobile) .dropdown-action-btn {
		gap: 10px;
		padding: 10px 12px;
		font-size: 15px;
		border-radius: 5px;
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
		background: color-mix(in srgb, var(--bg-sidebar) 85%, transparent);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border-top: 1px solid var(--border-color);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
		display: flex;
		flex-direction: column;
		z-index: 20;
	}

	.settings-panel {
		position: absolute;
		bottom: var(--header-height);
		left: 0;
		width: 100%;
		background: color-mix(in srgb, var(--bg-sidebar) 92%, transparent);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border-top: 1px solid var(--border-color);
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
		padding: 8px;
		z-index: 20;
	}

	.settings-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 4px 4px 8px;
		font-size: 12px;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.close-settings-btn {
		font-size: 20px;
		line-height: 1;
		padding: 0 4px;
		color: var(--text-muted);
	}

	.settings-section + .settings-section {
		border-top: 1px solid var(--border-color);
		margin-top: 8px;
		padding-top: 8px;
	}

	.settings-section-title {
		display: block;
		padding: 0 6px 4px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.settings-action {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 8px 6px;
		border-radius: 5px;
		color: var(--text-main);
		font-size: 13px;
		text-align: left;
		text-decoration: none;
		transition: background var(--transition-speed);
	}

	.settings-action:hover {
		background: var(--hover-sidebar);
	}

	.settings-action:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.settings-action :global(svg) {
		color: var(--text-muted);
	}

	.settings-help,
	.settings-cleanup-message {
		margin: 3px 6px 0;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-muted);
	}

	.settings-cleanup-message {
		color: var(--text-main);
	}

	.notion-import-input {
		display: none;
	}

	.notion-import-preview {
		display: grid;
		gap: 5px;
		margin: 5px 6px 0;
		font-size: 11px;
		line-height: 1.35;
		color: var(--text-main);
	}

	.notion-import-warning {
		color: var(--text-muted);
	}

	.notion-import-confirm {
		margin-top: 2px;
		color: var(--accent-color);
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

	/* Sidebar Search Styles */
	.sidebar-search-container {
		position: relative;
		width: 100%;
		display: flex;
		flex-direction: column;
	}

	.sidebar-search-input-wrapper {
		display: flex;
		align-items: center;
		background-color: var(--hover-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		padding: 6px 10px;
		gap: 8px;
		width: 100%;
	}

	.sidebar-search-input-wrapper input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		font-size: 14px;
		color: var(--text-main);
		font-family: inherit;
		min-width: 0;
	}

	.sidebar-search-input-wrapper input::placeholder {
		color: var(--text-muted);
	}

	:global(.mobile) .sidebar-search-input-wrapper {
		padding: 9px 12px;
		gap: 10px;
		border-radius: 8px;
	}

	:global(.mobile) .sidebar-search-input-wrapper input {
		font-size: 16px;
	}

	:global(.mobile) :global(.sidebar-search-icon) {
		width: 18px;
		height: 18px;
	}

	:global(.sidebar-search-icon) {
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.clear-search-btn {
		font-size: 10px;
		color: var(--text-muted);
		padding: 2px;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.clear-search-btn:hover {
		color: var(--text-main);
	}

	.sidebar-search-results {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		margin-top: 4px;
		background-color: color-mix(in srgb, var(--bg-sidebar) 85%, transparent);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
		z-index: 100;
		max-height: 250px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		padding: 4px;
	}

	.sidebar-search-result-item {
		display: flex;
		align-items: flex-start;
		padding: 6px 10px;
		border-radius: 4px;
		gap: 8px;
		font-size: 14px;
		color: var(--text-main);
		text-decoration: none;
		transition: background var(--transition-speed);
	}

	.sidebar-search-result-item:hover,
	.sidebar-search-result-item.focused {
		background-color: var(--hover-sidebar);
	}

	.sidebar-result-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
		margin-top: 2px;
	}

	.sidebar-result-body {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}

	.sidebar-result-title {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-weight: 500;
	}

	.sidebar-result-snippet {
		font-size: 11px;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		margin-top: 2px;
	}

	.sidebar-result-snippet :global(b) {
		color: var(--text-main);
		font-weight: 700;
		background-color: var(--selection-bg);
		padding: 0 2px;
		border-radius: 2px;
	}

	.footer-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 4px 8px;
	}

	.footer-icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 38px;
		height: 38px;
		border-radius: 6px;
		color: var(--text-muted);
		transition: background var(--transition-speed), color var(--transition-speed);
		position: relative;
	}

	.footer-icon-btn:hover {
		background-color: var(--hover-sidebar);
		color: var(--text-main);
	}

	.trash-badge-bubble {
		position: absolute;
		top: 1px;
		right: 1px;
		background-color: var(--border-color);
		color: var(--text-muted);
		font-size: 9px;
		min-width: 14px;
		height: 14px;
		padding: 0 3px;
		border-radius: 7px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		border: 1px solid var(--bg-sidebar);
	}
</style>
