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
		Lock,
		FileDown,
		MoreHorizontal,
		Settings,
		FileUp,
		LogOut,
		Maximize2
	} from 'lucide-svelte';
	import type { PageNode } from '$lib/server/pages';

	// SvelteKit Props
	let { data, children } = $props();

	// App Layout States
	let isSidebarOpen = $state(true);
	let isDarkMode = $state(false);
	let editorTextSize = $state(16);
	let isMobile = $state(false);
	let isTrashOpen = $state(false);
	let isSettingsOpen = $state(false);
	let isEditorTextSizeOpen = $state(false);
	let isCleanupInProgress = $state(false);
	let cleanupMessage = $state('');
	let notionImportInput = $state<HTMLInputElement | null>(null);
	let notionImportFile = $state<File | null>(null);
	let notionImportPreview = $state<{
		pageCount: number;
		imageCount: number;
		remoteImageCount: number;
		skippedImageCount: number;
		warnings: string[];
	} | null>(null);
	let isNotionPreviewInProgress = $state(false);
	let isNotionImportInProgress = $state(false);
	let notionImportMessage = $state('');
	let notionImportError = $state('');
	let notionImportDialogOpen = $state(false);
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
	const editorTextSizeStorageKey = 'aporia-editor-text-size';
	const editorTextSizeOptions = [
		{ value: 14, label: 'Small' },
		{ value: 16, label: 'Default' },
		{ value: 18, label: 'Large' },
		{ value: 20, label: 'Largest' }
	] as const;

	// Search States
	let isSearchOpen = $state(false);
	let searchQuery = $state('');
	let searchResults = $state<any[]>([]);
	let searchFocusedIndex = $state(0);
	let sidebarSearchInputEl = $state<HTMLInputElement | null>(null);
	let searchContainerEl = $state<HTMLDivElement | null>(null);
	let editorTextSizeMenuEl = $state<HTMLDivElement | null>(null);

	// Inline editing title states
	let editingPageId = $state<string | null>(null);
	let editingTitleText = $state('');
	let draggedPageId = $state<string | null>(null);
	let dropTarget = $state<{ id: string; placement: 'before' | 'inside' | 'after' } | null>(null);
	// Section Title States
	let sectionTitle = $state(initialSectionTitle());
	let isEditingSectionTitle = $state(false);
	
	// Dropdown menu state
	let openMenuPageId = $state<string | null>(null);

	// Active page tracking from route params
	let currentPageId = $derived($page.params.id || null);
	let currentPage = $derived(data.activePages?.find((page) => page.id === currentPageId));
	let isCurrentPageFullWidth = $state(false);
	let isFullWidthRequestInFlight = $state(false);
	let isAuthRoute = $derived($page.url.pathname === '/login' || $page.url.pathname === '/setup' || $page.url.pathname === '/change-password');

	$effect(() => {
		isCurrentPageFullWidth = currentPage?.isFullWidth === 1;
	});

	function editorTextSizeStorageKeyForPage(pageId: string) {
		return `${editorTextSizeStorageKey}:${pageId}`;
	}

	$effect(() => {
		const pageId = currentPageId;
		if (typeof window === 'undefined') return;

		if (!pageId) {
			editorTextSize = 16;
			return;
		}

		const serverEditorTextSize = data.editorTextSizes?.[pageId];
		const localEditorTextSize = Number(localStorage.getItem(editorTextSizeStorageKeyForPage(pageId)));
		editorTextSize = editorTextSizeOptions.some((option) => option.value === serverEditorTextSize)
			? serverEditorTextSize
			: editorTextSizeOptions.some((option) => option.value === localEditorTextSize)
				? localEditorTextSize
				: 16;
	});

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
			if (isEditorTextSizeOpen && editorTextSizeMenuEl && !editorTextSizeMenuEl.contains(e.target as Node)) {
				isEditorTextSizeOpen = false;
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

	async function toggleFullWidth() {
		if (!currentPageId || !currentPage || isFullWidthRequestInFlight) return;

		const previousValue = isCurrentPageFullWidth;
		isCurrentPageFullWidth = !previousValue;
		isFullWidthRequestInFlight = true;

		try {
			const response = await fetch(`/api/pages/${currentPageId}/layout`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ isFullWidth: isCurrentPageFullWidth })
			});
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);
			isCurrentPageFullWidth = result.isFullWidth;
			await invalidateAll();
		} catch (error) {
			isCurrentPageFullWidth = previousValue;
			console.error('Full-width update failed:', error);
		} finally {
			isFullWidthRequestInFlight = false;
		}
	}

	function setEditorTextSize(size: number) {
		if (!currentPageId || !editorTextSizeOptions.some((option) => option.value === size)) return;
		editorTextSize = size;
		const pageId = currentPageId;
		localStorage.setItem(editorTextSizeStorageKeyForPage(pageId), String(size));
		void fetch('/api/settings', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ key: editorTextSizeStorageKeyForPage(pageId), value: String(size) })
		}).then((response) => {
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
		}).catch((error) => {
			console.error('Failed to save editor text size:', error);
		});
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
		notionImportError = '';
		try {
			const formData = new FormData();
			formData.set('archive', file);
			const response = await fetch('/api/import/notion/preview', { method: 'POST', body: formData });
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || 'Unable to read the Notion export');
			notionImportPreview = result.preview;
		} catch (error) {
			notionImportFile = null;
			notionImportError = error instanceof Error ? error.message : 'Unable to read the Notion export';
			notionImportMessage = error instanceof Error ? error.message : 'Unable to read the Notion export';
			notionImportDialogOpen = true;
		} finally {
			isNotionPreviewInProgress = false;
		}
	}

	function selectNotionImport(event: Event) {
		const file = (event.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		notionImportFile = file;
		notionImportDialogOpen = true;
		void previewNotionImport(file);
	}

	async function applyNotionImport() {
		if (!notionImportFile || !notionImportPreview || isNotionImportInProgress) return;

		isNotionImportInProgress = true;
		notionImportMessage = '';
		notionImportError = '';
		try {
			const formData = new FormData();
			formData.set('archive', notionImportFile);
			const response = await fetch('/api/import/notion/apply', { method: 'POST', body: formData });
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || 'Unable to import the Notion export');
			notionImportMessage = `Imported ${result.result.pageCount} page${result.result.pageCount === 1 ? '' : 's'} into “${result.result.rootTitle}”.`;
			notionImportFile = null;
			notionImportPreview = null;
			notionImportError = '';
			notionImportDialogOpen = true;
			if (notionImportInput) notionImportInput.value = '';
			await invalidateAll();
		} catch (error) {
			notionImportError = error instanceof Error ? error.message : 'Unable to import the Notion export';
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

	{#if isAuthRoute}
		<div class="auth-route-shell">
			{@render children()}
		</div>
	{:else}

	<div
	class="app-container" 
	class:sidebar-closed={!isSidebarOpen} 
	class:mobile={isMobile} 
	style="--sidebar-width: {sidebarWidth}px; --editor-font-size: {editorTextSize}px;"
>
	<!-- Sidebar -->
	<aside class="sidebar">
		<div class="sidebar-header">
			<div class="user-workspace">
				<img src="/aporia-logo.svg" alt="Aporia Logo" class="workspace-logo" />
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
									<PageIcon icon={result.icon} color={result.iconColor} size={14} />
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
								<PageIcon icon={trashPage.icon} color={trashPage.iconColor} size={14} />
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
				<div class="trash-panel-footer">
					<button class="trash-cleanup-btn" disabled={isCleanupInProgress} onclick={cleanUnusedUploads}>
						<Trash2 size={14} />
						<span>{isCleanupInProgress ? 'Cleaning unused uploads…' : 'Clean unused uploads'}</span>
					</button>
					{#if cleanupMessage}
						<p class="trash-cleanup-message">{cleanupMessage}</p>
					{/if}
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
				<div class="footer-right-actions">
					<button
						class="footer-icon-btn"
						onclick={toggleTheme}
						title={isDarkMode ? 'Use light mode' : 'Use dark mode'}
						aria-label={isDarkMode ? 'Use light mode' : 'Use dark mode'}
					>
						{#if isDarkMode}
							<Sun size={18} />
						{:else}
							<Moon size={18} />
						{/if}
					</button>
					<div class="editor-text-size-menu" bind:this={editorTextSizeMenuEl}>
						<button
							class="footer-icon-btn text-size-trigger"
							class:active={isEditorTextSizeOpen}
							disabled={!currentPageId}
							onclick={() => {
								isEditorTextSizeOpen = !isEditorTextSizeOpen;
								isSettingsOpen = false;
								isTrashOpen = false;
							}}
							title={currentPageId ? 'Editor text size' : 'Open a page to change editor text size'}
							aria-label="Editor text size"
						>
							<span class="text-size-letter">A</span>
						</button>
						{#if isEditorTextSizeOpen && currentPageId}
							<div class="text-size-popover" role="group" aria-label="Editor text size">
								<span class="text-size-popover-title">Text size</span>
								{#each editorTextSizeOptions as option}
									<button
										type="button"
										class="text-size-option"
										class:active={editorTextSize === option.value}
										aria-pressed={editorTextSize === option.value}
										onclick={() => { setEditorTextSize(option.value); isEditorTextSizeOpen = false; }}
									>
										<span style="font-size: {Math.max(13, option.value - 1)}px;">A</span>
										<span>{option.label}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
					{#if !isMobile}
						<button
							type="button"
							class="footer-icon-btn full-width-trigger"
							class:active={isCurrentPageFullWidth}
							disabled={!currentPageId || isFullWidthRequestInFlight}
							aria-pressed={isCurrentPageFullWidth}
							onclick={toggleFullWidth}
							title={isCurrentPageFullWidth ? 'Use centered width' : 'Use full width'}
							aria-label={isCurrentPageFullWidth ? 'Use centered width' : 'Use full width'}
						>
							<Maximize2 size={18} />
						</button>
					{/if}
					<button
						class="footer-icon-btn"
						onclick={() => {
							isSettingsOpen = !isSettingsOpen;
							isEditorTextSizeOpen = false;
							isTrashOpen = false;
						}}
						title="Settings"
						aria-label="Open settings"
					>
						<Settings size={18} />
					</button>
				</div>
			</div>
		</div>

		{#if isSettingsOpen}
			<div class="settings-panel" aria-label="Settings">
				<div class="settings-panel-header">
					<div class="settings-panel-heading">
						<span class="settings-panel-title">Settings</span>
					</div>
					<button type="button" class="close-settings-btn" onclick={() => isSettingsOpen = false} aria-label="Close settings">×</button>
				</div>

				<div class="settings-section">
					<span class="settings-section-title">Import &amp; Export</span>
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
					<input
						bind:this={notionImportInput}
						class="notion-import-input"
						type="file"
						accept=".zip,.html,.htm,application/zip,application/x-zip-compressed,text/html"
						onchange={selectNotionImport}
					/>
					<button class="settings-action" disabled={isNotionPreviewInProgress || isNotionImportInProgress} onclick={() => notionImportInput?.click()}>
						<FileUp size={16} />
						<span>{isNotionPreviewInProgress ? 'Reading Notion export…' : 'Import from Notion'}</span>
					</button>
				</div>

				<div class="settings-section settings-account-section">
					<span class="settings-section-title">Account</span>
					<a href="/change-password" class="settings-action" onclick={() => isSettingsOpen = false}>
						<Lock size={16} />
						<span>Change password</span>
					</a>
					<form method="POST" action="/logout">
						<button type="submit" class="settings-action">
							<LogOut size={16} />
							<span>Log out</span>
						</button>
					</form>
					<form method="POST" action="/logout-all">
						<button type="submit" class="settings-action settings-danger">
							<LogOut size={16} />
							<span>Log out all devices</span>
						</button>
					</form>
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

	{#if notionImportDialogOpen}
		<div class="notion-import-modal-backdrop" role="presentation">
			<div class="notion-import-modal" role="dialog" aria-modal="true" aria-labelledby="notion-import-modal-title">
				<div class="notion-import-modal-header">
					<div>
						<h2 id="notion-import-modal-title">Import from Notion</h2>
						<p>Choose a Notion HTML export ZIP or standalone HTML file. ZIP files preserve local images; standalone HTML only preserves embedded and external images.</p>
					</div>
					<button type="button" class="notion-import-modal-close" onclick={() => notionImportDialogOpen = false} aria-label="Close import dialog">×</button>
				</div>

				{#if isNotionPreviewInProgress}
					<p class="notion-import-modal-status">Reading Notion export…</p>
				{:else if isNotionImportInProgress}
					<p class="notion-import-modal-status">Importing pages…</p>
				{:else if notionImportError}
					<p class="notion-import-modal-error">{notionImportError}</p>
					{#if notionImportPreview && notionImportFile}
						<button type="button" class="settings-action notion-import-confirm" onclick={applyNotionImport}>
							<FileUp size={16} />
							<span>Retry import</span>
						</button>
					{/if}
				{:else if notionImportMessage}
					<p class="notion-import-modal-success">{notionImportMessage}</p>
				{:else if notionImportPreview}
					<div class="notion-import-modal-preview">
						<p>{notionImportPreview.pageCount} page{notionImportPreview.pageCount === 1 ? '' : 's'} · {notionImportPreview.imageCount} image{notionImportPreview.imageCount === 1 ? '' : 's'} imported{notionImportPreview.remoteImageCount > 0 ? ` · ${notionImportPreview.remoteImageCount} external` : ''}{notionImportPreview.skippedImageCount > 0 ? ` · ${notionImportPreview.skippedImageCount} skipped` : ''}</p>
						{#each notionImportPreview.warnings as warning}
							<span class="notion-import-warning">{warning}</span>
						{/each}
						<button type="button" class="settings-action notion-import-confirm" onclick={applyNotionImport}>
							<FileUp size={16} />
							<span>Import pages</span>
						</button>
					</div>
				{:else}
					<p class="notion-import-modal-error">Choose an HTML or ZIP file to begin.</p>
				{/if}
			</div>
		</div>
	{/if}

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
				{#if !isMobile}
					<div class="breadcrumbs">
						{#if currentPageId}
							{#each breadcrumbs as crumb, i}
								{#if i > 0}
									<span class="breadcrumb-separator">/</span>
								{/if}
								{#if i === breadcrumbs.length - 1}
									<span class="breadcrumb-item active">
										<span class="breadcrumb-icon">
											<PageIcon icon={crumb.icon} color={crumb.iconColor} size={14} />
										</span>
										<span>{crumb.title || 'Untitled'}</span>
									</span>
								{:else}
									<a href="/{crumb.id}" class="breadcrumb-item link">
										<span class="breadcrumb-icon">
											<PageIcon icon={crumb.icon} color={crumb.iconColor} size={14} />
										</span>
										<span>{crumb.title || 'Untitled'}</span>
									</a>
								{/if}
							{/each}
						{:else}
							<span class="breadcrumb-item active">Workspace</span>
						{/if}
					</div>
				{/if}
			</div>


		</header>

		<!-- Canvas Area -->
		<div class="canvas-wrapper">
			<div class="canvas" class:full-width={isCurrentPageFullWidth}>
				{@render children()}
			</div>
		</div>
</main>
</div>
{/if}



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
							<ChevronDown size={13} />
						{:else}
							<ChevronRight size={13} />
						{/if}
					</button>
					<span class="page-emoji">
						<PageIcon icon={node.icon} color={node.iconColor} size={18} />
					</span>
				{:else}
					<span class="page-emoji">
						<PageIcon icon={node.icon} color={node.iconColor} size={18} />
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
					<MoreHorizontal size={isMobile ? 20 : 18} />
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
	.auth-route-shell {
		min-height: 100vh;
		width: 100%;
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
		width: 22px;
		height: 22px;
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
		font-size: 14px;
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
		font-size: 15px;
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
		bottom: calc(var(--header-height) + 16px);
		left: 0;
		width: 100%;
		max-height: min(72vh, 560px);
		overflow-y: auto;
		background: color-mix(in srgb, var(--bg-sidebar) 92%, transparent);
		backdrop-filter: blur(20px);
		-webkit-backdrop-filter: blur(20px);
		border: 1px solid var(--border-color);
		border-left: 0;
		border-right: 0;
		border-radius: 10px 10px 0 0;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
		padding: 8px;
		z-index: 20;
		scrollbar-width: thin;
	}

	.settings-panel-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 2px 4px 6px;
		margin-bottom: 2px;
	}

	.settings-panel-heading {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.settings-panel-title {
		font-size: 14px;
		font-weight: 650;
		color: var(--text-main);
	}

	.close-settings-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 6px;
		font-size: 18px;
		line-height: 1;
		color: var(--text-muted);
	}

	.close-settings-btn:hover {
		background: var(--hover-sidebar);
		color: var(--text-main);
	}

	.settings-section {
		padding: 6px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--bg-sidebar) 78%, transparent);
	}

	.settings-section + .settings-section {
		margin-top: 6px;
	}

	.settings-section-title {
		display: block;
		padding: 0 4px 4px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.settings-action {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 30px;
		padding: 5px 8px;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--text-main);
		font-size: 13px;
		text-align: left;
		text-decoration: none;
		transition: background var(--transition-speed);
	}

	.settings-action:hover {
		background: var(--hover-sidebar);
		border-color: var(--border-color);
	}

	.settings-action.settings-danger {
		color: var(--error-color);
	}

	.settings-action.settings-danger :global(svg) {
		color: var(--error-color);
	}

	.settings-action:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.settings-account-section {
		padding: 8px 0 0;
		border-radius: 0;
		background: transparent;
	}

	.settings-action :global(svg) {
		color: var(--text-muted);
	}

	.notion-import-input {
		display: none;
	}

	.notion-import-warning {
		color: var(--text-muted);
	}

	.notion-import-confirm {
		margin-top: 2px;
		color: var(--accent-color);
	}

	.notion-import-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: rgb(0 0 0 / 42%);
	}

	.notion-import-modal {
		width: min(440px, 100%);
		padding: 20px;
		border: 1px solid var(--border-color);
		border-radius: 12px;
		background: var(--bg-canvas);
		box-shadow: 0 18px 50px rgba(0, 0, 0, 0.2);
	}

	.notion-import-modal-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
	}

	.notion-import-modal-header h2 {
		margin: 0;
		font-size: 17px;
		font-weight: 650;
		color: var(--text-main);
	}

	.notion-import-modal-header p {
		margin: 8px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-muted);
	}

	.notion-import-modal-close {
		flex: 0 0 auto;
		width: 28px;
		height: 28px;
		border: 0;
		border-radius: 6px;
		color: var(--text-muted);
		font-size: 20px;
		line-height: 1;
		background: transparent;
		cursor: pointer;
	}

	.notion-import-modal-close:hover {
		background: var(--hover-sidebar);
		color: var(--text-main);
	}

	.notion-import-modal-status,
	.notion-import-modal-success,
	.notion-import-modal-error,
	.notion-import-modal-preview {
		margin: 18px 0 0;
		font-size: 13px;
		line-height: 1.45;
	}

	.notion-import-modal-status {
		color: var(--text-muted);
	}

	.notion-import-modal-success {
		color: var(--success-color, #2f855a);
	}

	.notion-import-modal-error {
		color: var(--error-color);
	}

	.notion-import-modal-preview {
		display: grid;
		gap: 7px;
		color: var(--text-main);
	}

	.notion-import-modal-preview p {
		margin: 0;
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

	.trash-panel-footer {
		padding: 7px 8px 8px;
		border-top: 1px solid var(--border-color);
	}

	.trash-cleanup-btn {
		display: flex;
		align-items: center;
		gap: 7px;
		width: 100%;
		min-height: 30px;
		padding: 6px 7px;
		border: 1px solid transparent;
		border-radius: 5px;
		color: var(--text-main);
		font-size: 12px;
		text-align: left;
		transition: background var(--transition-speed), border-color var(--transition-speed);
	}

	.trash-cleanup-btn:hover:not(:disabled) {
		background: var(--hover-sidebar);
		border-color: var(--border-color);
	}

	.trash-cleanup-btn :global(svg) {
		color: var(--text-muted);
	}

	.trash-cleanup-btn:disabled {
		opacity: 0.6;
		cursor: wait;
	}

	.trash-cleanup-message {
		margin: 3px 5px 0;
		font-size: 10px;
		line-height: 1.35;
		color: var(--text-muted);
	}

	.trash-cleanup-message {
		color: var(--text-main);
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

	.footer-right-actions {
		display: flex;
		align-items: center;
		gap: 2px;
	}

	.editor-text-size-menu {
		position: relative;
	}

	.full-width-trigger.active,
	.full-width-trigger:not(:disabled):hover {
		background-color: var(--hover-sidebar);
		color: var(--accent-color);
	}

	.full-width-trigger:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.canvas.full-width {
		max-width: none;
		width: calc(100% - clamp(48px, 8vw, 160px));
	}

	@media (max-width: 767px) {
		.canvas.full-width {
			width: 100%;
		}
	}

	.text-size-trigger {
		font-family: Georgia, serif;
		font-size: 18px;
		font-weight: 600;
		font-style: italic;
	}

	.text-size-trigger.active,
	.text-size-trigger:not(:disabled):hover {
		background-color: var(--hover-sidebar);
		color: var(--text-main);
	}

	.text-size-trigger:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.text-size-letter {
		line-height: 1;
	}

	.text-size-popover {
		position: absolute;
		right: 0;
		bottom: calc(100% + 6px);
		width: 148px;
		padding: 6px;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		background: color-mix(in srgb, var(--bg-sidebar) 96%, transparent);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
		z-index: 25;
	}

	.text-size-popover-title {
		display: block;
		padding: 4px 6px 6px;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.5px;
		text-transform: uppercase;
		color: var(--text-muted);
	}

	.text-size-option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px;
		border-radius: 5px;
		color: var(--text-muted);
		font-size: 12px;
		text-align: left;
	}

	.text-size-option:hover,
	.text-size-option.active {
		background: var(--hover-sidebar);
		color: var(--text-main);
	}

	.text-size-option.active {
		color: var(--accent-color);
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
