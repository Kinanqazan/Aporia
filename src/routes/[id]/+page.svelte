<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, onDestroy } from 'svelte';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { ColumnLayout } from '$lib/editor/extensions/ColumnLayout';
	import { Column } from '$lib/editor/extensions/Column';
	import { Cloud, CloudLightning, Plus, GripVertical, Trash2, Copy, Heading1, Heading2, Heading3, Type, Quote, Code } from 'lucide-svelte';

	let { data } = $props();
	
	// Local state bound to input elements for title and icon
	let title = $state(data.pageRecord.title);
	let icon = $state(data.pageRecord.icon || '📄');
	
	// Tiptap states
	let editorElement = $state<HTMLDivElement>();
	let editor = $state<Editor>();
	let autosaveStatus = $state<'saved' | 'saving' | 'error'>('saved');
	let autosaveTimeout: any;

	// Floating block gutter states
	let activeBlockNode = $state<HTMLElement | null>(null);
	let isGutterVisible = $state(false);
	let gutterTop = $state(0);
	let gutterLeft = $state(0);
	let isActionMenuOpen = $state(false);
	const GUTTER_HIT_SLOP = 36;
	
	// Drag state
	let draggedBlockIndex = $state<number | null>(null);
	let dropLineTop = $state<number | null>(null);
	// Vertical drop indicator for column creation
	let dropLineVertical = $state<{ top: number; left: number; height: number } | null>(null);
	let dropMode = $state<'vertical' | 'horizontal'>('vertical');

	/** Structured path to a block: top-level index, and optionally column + child index */
	type BlockPath = {
		topIndex: number;
		columnIndex?: number;
		childIndex?: number;
	};
	let draggedBlockPath = $state<BlockPath | null>(null);

	let isMobile = $state(false);

	function handleResize() {
		isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
	}

	// Reset inputs when navigating between pages
	$effect(() => {
		title = data.pageRecord.title;
		icon = data.pageRecord.icon || '📄';
		isGutterVisible = false;
		isActionMenuOpen = false;
		
		if (editor && data.pageRecord) {
			const currentJson = editor.getJSON();
			const serverJsonStr = data.pageRecord.contentJson;
			let serverJson = { type: 'doc', content: [] };
			try {
				serverJson = serverJsonStr ? JSON.parse(serverJsonStr) : { type: 'doc', content: [] };
			} catch (e) {
				console.error('Failed to parse contentJson', e);
			}

			if (JSON.stringify(currentJson) !== JSON.stringify(serverJson)) {
				editor.commands.setContent(serverJson, false);
			}
		}
	});

	onMount(() => {
		let initialContent = { type: 'doc', content: [] };
		try {
			initialContent = data.pageRecord.contentJson 
				? JSON.parse(data.pageRecord.contentJson) 
				: { type: 'doc', content: [] };
		} catch (e) {
			console.error('Failed parsing initial contentJson', e);
		}

		editor = new Editor({
			element: editorElement,
			extensions: [
				StarterKit.configure({
					heading: {
						levels: [1, 2, 3]
					}
				}),
				ColumnLayout,
				Column
			],
			content: initialContent,
			editorProps: {
				attributes: {
					class: 'tiptap-content-canvas'
				}
			},
			onUpdate: ({ editor }) => {
				const jsonContent = editor.getJSON();
				const jsonStr = JSON.stringify(jsonContent);
				triggerAutosave(jsonStr);
			}
		});

		// Listen to global mousemoves to position the floating gutter block handle
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('click', handleGlobalClick);
		window.addEventListener('dragover', handleDragOver, { capture: true });
		window.addEventListener('drop', handleDrop, { capture: true });
		
		handleResize();
		window.addEventListener('resize', handleResize);
	});

	onDestroy(() => {
		if (editor) {
			editor.destroy();
		}
		clearTimeout(autosaveTimeout);
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousemove', handleMouseMove);
			window.removeEventListener('click', handleGlobalClick);
			window.removeEventListener('dragover', handleDragOver, { capture: true });
			window.removeEventListener('drop', handleDrop, { capture: true });
			window.removeEventListener('resize', handleResize);
		}
	});

	function handleMouseMove(e: MouseEvent) {
		if (!editorElement || !editor || isActionMenuOpen) return;

		const editorRect = editorElement.getBoundingClientRect();
		
		// Ensure mouse is horizontally near the editor bounds
		if (e.clientX < editorRect.left - 80 || e.clientX > editorRect.right + 20) {
			isGutterVisible = false;
			return;
		}

		// Find any block node at the cursor Y — including blocks inside columns
		// Filter out column-layout and column wrapper divs BEFORE find(),
		// otherwise the wrapper's bounding rect matches first and steals the hit.
		const allBlocks = Array.from(editorElement.querySelectorAll(
			'.ProseMirror > *, .ProseMirror > .column-layout > .column > *'
		)).filter(node => {
			const el = node as HTMLElement;
			return !el.classList.contains('column-layout') && !el.classList.contains('column');
		});
		const blocksAtY = allBlocks.filter(node => {
			const rect = node.getBoundingClientRect();
			return e.clientY >= rect.top - 2 &&
				e.clientY <= rect.bottom + 2;
		});
		const block = blocksAtY.find(node => {
			const rect = node.getBoundingClientRect();
			return e.clientX >= rect.left && e.clientX <= rect.right;
		}) ?? blocksAtY
			.map(node => ({ node, distance: Math.abs(e.clientX - (node.getBoundingClientRect().left - 28)) }))
			.filter(({ distance }) => distance <= GUTTER_HIT_SLOP)
			.sort((a, b) => a.distance - b.distance)[0]?.node;

		if (block && block instanceof HTMLElement) {
			activeBlockNode = block;
			const blockRect = block.getBoundingClientRect();
			
			// Position the handle next to the hovered block, including blocks inside
			// a right-hand column, rather than keeping it in the editor's left gutter.
			gutterTop = blockRect.top - editorRect.top + (blockRect.height / 2) - 10; 
			gutterLeft = blockRect.left - editorRect.left - 28;
			isGutterVisible = true;
		} else {
			isGutterVisible = false;
		}
	}

	function handleGlobalClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('.block-gutter') && !target.closest('.block-action-menu')) {
			isActionMenuOpen = false;
		}
	}

	function triggerAutosave(contentJson: string) {
		autosaveStatus = 'saving';
		clearTimeout(autosaveTimeout);
		autosaveTimeout = setTimeout(async () => {
			try {
				const response = await fetch(`/api/pages/${data.pageRecord.id}`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({ contentJson })
				});
				const result = await response.json();
				if (result.success) {
					autosaveStatus = 'saved';
				} else {
					autosaveStatus = 'error';
				}
			} catch (err) {
				console.error('Autosave failed:', err);
				autosaveStatus = 'error';
			}
		}, 1000);
	}

	let titleForm: HTMLFormElement;
	let iconForm: HTMLFormElement;

	function handleTitleBlur() {
		if (title !== data.pageRecord.title) {
			titleForm.requestSubmit();
		}
	}

	function handleIconBlur() {
		if (icon !== data.pageRecord.icon) {
			iconForm.requestSubmit();
		}
	}

	// ==========================================================================
	// BLOCK MANIPULATION ACTIONS
	// ==========================================================================

	// Get index of the hovered block in the editor doc (supports nested column blocks)
	function getActiveBlockIndex(): number {
		if (!editor || !activeBlockNode) return -1;
		
		const nodes = Array.from(editorElement?.querySelector('.ProseMirror')?.children || []);
		// First check top-level
		const topIndex = nodes.indexOf(activeBlockNode);
		if (topIndex !== -1) return topIndex;
		// If not found top-level, find the parent column-layout
		const columnEl = activeBlockNode.closest('.column');
		const layoutEl = columnEl?.closest('.column-layout');
		if (layoutEl) {
			return nodes.indexOf(layoutEl);
		}
		return -1;
	}

	/** Get a structured path to the active block (supports column nesting) */
	function getActiveBlockPath(): BlockPath | null {
		if (!editor || !activeBlockNode || !editorElement) return null;
		const topNodes = Array.from(editorElement.querySelector('.ProseMirror')?.children || []);

		// Check if it's a top-level block
		const topIndex = topNodes.indexOf(activeBlockNode);
		if (topIndex !== -1) return { topIndex };

		// Check if it's inside a column
		const columnEl = activeBlockNode.closest('[data-type="column"]');
		const layoutEl = columnEl?.closest('[data-type="columnLayout"]');
		if (!columnEl || !layoutEl) return null;

		const layoutTopIndex = topNodes.indexOf(layoutEl);
		if (layoutTopIndex === -1) return null;

		const columns = Array.from(layoutEl.children);
		const columnIndex = columns.indexOf(columnEl);
		const children = Array.from(columnEl.children);
		const childIndex = children.indexOf(activeBlockNode);

		return { topIndex: layoutTopIndex, columnIndex, childIndex };
	}

	function deleteActiveBlock() {
		if (!editor || !activeBlockNode) return;
		const index = getActiveBlockIndex();
		if (index === -1) return;

		// Select the block node in Tiptap transaction and delete it
		editor.commands.focus();
		
		// Calculate position bounds
		let currentPos = 0;
		editor.state.doc.descendants((node, pos) => {
			if (node.isBlock && pos > 0 && currentPos === 0) {
				const domNode = editor.view.nodeDOM(pos);
				if (domNode === activeBlockNode) {
					currentPos = pos;
				}
			}
			return true;
		});

		if (currentPos > 0) {
			editor.commands.deleteRange({ from: currentPos - 1, to: currentPos + activeBlockNode.textContent!.length + 1 });
		} else {
			const pos = editor.view.posAtDOM(activeBlockNode, 0);
			editor.commands.setTextSelection(pos);
			editor.commands.selectNodeBackward();
			editor.commands.deleteSelection();
		}

		isActionMenuOpen = false;
		isGutterVisible = false;
	}

	function duplicateActiveBlock() {
		if (!editor || !activeBlockNode) return;
		const index = getActiveBlockIndex();
		if (index === -1) return;

		const docJson = editor.getJSON();
		if (docJson.content && docJson.content[index]) {
			const blockClone = JSON.parse(JSON.stringify(docJson.content[index]));
			docJson.content.splice(index + 1, 0, blockClone);
			editor.commands.setContent(docJson, true);
		}

		isActionMenuOpen = false;
		isGutterVisible = false;
	}

	function convertActiveBlockTo(type: 'paragraph' | 'heading' | 'blockquote' | 'codeBlock', level?: number) {
		if (!editor || !activeBlockNode) return;
		const index = getActiveBlockIndex();
		if (index === -1) return;

		editor.commands.focus();
		const pos = editor.view.posAtDOM(activeBlockNode, 0);
		editor.commands.setTextSelection(pos);

		if (type === 'paragraph') {
			editor.commands.setParagraph();
		} else if (type === 'heading' && level) {
			editor.commands.toggleHeading({ level: level as any });
		} else if (type === 'blockquote') {
			editor.commands.toggleBlockquote();
		} else if (type === 'codeBlock') {
			editor.commands.toggleCodeBlock();
		}

		isActionMenuOpen = false;
		isGutterVisible = false;
	}

	// ==========================================================================
	// DRAG & DROP REORDERING HANDLERS
	// ==========================================================================

	function handleDragStart(e: DragEvent) {
		if (!activeBlockNode) return;
		const path = getActiveBlockPath();
		if (!path) return;

		// For compatibility with existing vertical drop, also store top-level index
		draggedBlockIndex = path.topIndex;
		draggedBlockPath = path;
		
		activeBlockNode.classList.add('block-dragging');
		
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setDragImage(activeBlockNode, 10, 10);
			e.dataTransfer.setData('application/aporia-block-path', JSON.stringify(path));
		}
	}

	function handleDragEnd() {
		draggedBlockIndex = null;
		draggedBlockPath = null;
		dropLineTop = null;
		dropLineVertical = null;
		dropMode = 'vertical';
		isGutterVisible = false;
	}

	/** Edge detection threshold in px — how close to left/right edge triggers column mode */
	const COLUMN_EDGE_THRESHOLD = 80;
	const MAX_COLUMNS = 5;

	function handleDragOver(e: DragEvent) {
		if (draggedBlockIndex === null || !editorElement) return;
		e.preventDefault();
		e.stopPropagation();

		const editorRect = editorElement.getBoundingClientRect();

		// Resolve the target block node at the current mouse Y coordinate
		const domNodes = Array.from(editorElement.querySelectorAll('.ProseMirror > *'));
		const targetBlock = domNodes.find(node => {
			const rect = node.getBoundingClientRect();
			return e.clientY >= rect.top && e.clientY <= rect.bottom;
		}) as HTMLElement;
		
		if (!targetBlock) { dropLineTop = null; dropLineVertical = null; return; }

		const targetIndex = domNodes.indexOf(targetBlock);
		if (targetIndex === -1 || targetIndex === draggedBlockIndex) { dropLineTop = null; dropLineVertical = null; return; }

		const rect = targetBlock.getBoundingClientRect();
		const relativeX = e.clientX - rect.left;
		const relativeY = e.clientY - rect.top;

		// Check if cursor is near the left or right edge → horizontal column drop
		const isNearLeftEdge = relativeX < COLUMN_EDGE_THRESHOLD;
		const isNearRightEdge = relativeX > (rect.width - COLUMN_EDGE_THRESHOLD);

		if (isNearLeftEdge || isNearRightEdge) {
			// Check column count limit: if target is already a columnLayout, count existing columns
			const docJson = editor?.getJSON();
			const targetNode = docJson?.content?.[targetIndex];
			if (targetNode?.type === 'columnLayout' && (targetNode.content?.length || 0) >= MAX_COLUMNS) {
				// Already at max columns, fall through to vertical mode
			} else {
				// Show vertical drop indicator
				dropMode = 'horizontal';
				dropLineTop = null;
				const lineLeft = isNearLeftEdge
					? rect.left - editorRect.left
					: rect.right - editorRect.left;
				dropLineVertical = {
					top: rect.top - editorRect.top,
					left: lineLeft,
					height: rect.height
				};
				return;
			}
		}

		// Default: vertical (above/below) drop mode
		dropMode = 'vertical';
		dropLineVertical = null;
		if (relativeY < rect.height / 2) {
			dropLineTop = rect.top - editorRect.top;
		} else {
			dropLineTop = rect.bottom - editorRect.top;
		}
	}

	/**
	 * Extract a block from the doc using a BlockPath.
	 * Handles both top-level blocks and blocks nested inside columnLayout > column.
	 * Returns the extracted block JSON. Mutates docContent in-place.
	 * Also cleans up empty columns and single-column layouts.
	 */
	function extractBlockByPath(docContent: any[], path: BlockPath): any {
		if (path.columnIndex !== undefined && path.childIndex !== undefined) {
			// Block is inside a column
			const layout = docContent[path.topIndex];
			if (!layout || layout.type !== 'columnLayout') {
				// Fallback: treat as top-level
				return docContent.splice(path.topIndex, 1)[0];
			}
			const column = layout.content[path.columnIndex];
			if (!column || !column.content) {
				return docContent.splice(path.topIndex, 1)[0];
			}
			const [block] = column.content.splice(path.childIndex, 1);

			// Clean up: remove empty columns
			layout.content = layout.content.filter((col: any) => col.content && col.content.length > 0);

			// If only 1 column left, unwrap it back to top-level blocks
			if (layout.content.length === 1) {
				const remaining = layout.content[0].content || [];
				docContent.splice(path.topIndex, 1, ...remaining);
			} else if (layout.content.length === 0) {
				docContent.splice(path.topIndex, 1);
			}

			return block;
		} else {
			// Top-level block
			return docContent.splice(path.topIndex, 1)[0];
		}
	}

	function handleDrop(e: DragEvent) {
		if (draggedBlockPath === null || !editor || !editorElement) return;
		e.preventDefault();
		e.stopPropagation();

		// Resolve drop target block node (top-level only for target)
		const domNodes = Array.from(editorElement.querySelectorAll('.ProseMirror > *'));
		const targetBlock = domNodes.find(node => {
			const rect = node.getBoundingClientRect();
			return e.clientY >= rect.top && e.clientY <= rect.bottom;
		}) as HTMLElement;

		if (!targetBlock) { handleDragEnd(); return; }

		const targetIndex = domNodes.indexOf(targetBlock);
		if (targetIndex === -1) { handleDragEnd(); return; }

		// Don't drop on itself (for top-level blocks)
		if (draggedBlockPath.columnIndex === undefined && targetIndex === draggedBlockPath.topIndex) {
			handleDragEnd();
			return;
		}

		const docJson = editor.getJSON();
		if (!docJson.content) { handleDragEnd(); return; }

		// Extract the dragged block using its path (handles nested column blocks)
		const draggedBlock = extractBlockByPath(docJson.content, draggedBlockPath);
		if (!draggedBlock) { handleDragEnd(); return; }

		if (dropMode === 'horizontal') {
			// === COLUMN DROP: Place blocks side-by-side ===
			const rect = targetBlock.getBoundingClientRect();
			const relativeX = e.clientX - rect.left;
			const isLeftSide = relativeX < COLUMN_EDGE_THRESHOLD;

			// Find the target node in the (now possibly shifted) content array
			// We need to re-find it since extraction may have shifted indices
			let actualTargetIndex = -1;
			for (let i = 0; i < docJson.content.length; i++) {
				const node = docJson.content[i];
				// Match by reference or by finding the node at the original target position
				if (i === targetIndex || (targetIndex > draggedBlockPath.topIndex && i === targetIndex - 1) || 
					(targetIndex <= draggedBlockPath.topIndex && i === targetIndex)) {
					actualTargetIndex = i;
					break;
				}
			}
			
			// Simpler: recalculate target after extraction
			// If dragged was before target, target shifted back by however many nodes were removed
			if (actualTargetIndex === -1 || actualTargetIndex >= docJson.content.length) {
				actualTargetIndex = Math.min(targetIndex, docJson.content.length - 1);
			}

			const targetNode = docJson.content[actualTargetIndex];
			if (!targetNode) { handleDragEnd(); return; }

			if (targetNode.type === 'columnLayout') {
				// Target is already a columnLayout → add a new column
				if ((targetNode.content?.length || 0) < MAX_COLUMNS) {
					const newCol = { type: 'column', content: [draggedBlock] };
					if (isLeftSide) {
						targetNode.content!.unshift(newCol);
					} else {
						targetNode.content!.push(newCol);
					}
				}
			} else {
				// Target is a normal block → wrap both into a new columnLayout
				const colA = { type: 'column', content: [targetNode] };
				const colB = { type: 'column', content: [draggedBlock] };
				const layout = {
					type: 'columnLayout',
					content: isLeftSide ? [colB, colA] : [colA, colB]
				};
				docJson.content[actualTargetIndex] = layout;
			}

			editor.commands.setContent(docJson, true);
		} else {
			// === VERTICAL DROP: Standard above/below reorder ===
			const rect = targetBlock.getBoundingClientRect();
			const relativeY = e.clientY - rect.top;
			const isInsertBefore = relativeY < rect.height / 2;

			// Calculate insert index (content may have shifted after extraction)
			let insertIndex = Math.min(targetIndex, docJson.content.length);
			if (draggedBlockPath.columnIndex === undefined) {
				// Top-level drag: standard index adjustment
				if (draggedBlockPath.topIndex < targetIndex) {
					insertIndex = targetIndex - 1;
				} else {
					insertIndex = targetIndex;
				}
			}
			if (!isInsertBefore) {
				insertIndex = Math.min(insertIndex + 1, docJson.content.length);
			}

			docJson.content.splice(insertIndex, 0, draggedBlock);

			// Final cleanup: unwrap any columnLayout that now has only 1 column
			docJson.content = docJson.content.map((node: any) => {
				if (node.type === 'columnLayout' && node.content?.length === 1) {
					return node.content[0].content || [];
				}
				return node;
			}).flat();

			editor.commands.setContent(docJson, true);
		}

		handleDragEnd();
	}
</script>

<article class="editor-page">
	<!-- Autosave Status Floating Indicator -->
	<div class="autosave-indicator" class:status-saving={autosaveStatus === 'saving'} class:status-error={autosaveStatus === 'error'}>
		{#if autosaveStatus === 'saved'}
			<Cloud size={14} />
			<span>Saved</span>
		{:else}
			<CloudLightning size={14} />
			<span>Saving...</span>
		{/if}
	</div>

	<!-- Page Icon emoji picker input -->
	<div class="page-icon-wrapper">
		<form 
			bind:this={iconForm}
			method="POST" 
			action="?/changeIcon" 
			use:enhance
			class="icon-form"
		>
			<input 
				type="text" 
				name="icon" 
				bind:value={icon}
				onblur={handleIconBlur}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				class="icon-input"
				title="Click to edit page emoji icon"
			/>
		</form>
	</div>

	<!-- Page Title editor input -->
	<form 
		bind:this={titleForm}
		method="POST" 
		action="?/renamePage" 
		use:enhance
		class="title-form"
	>
		<input 
			type="text" 
			name="title" 
			bind:value={title} 
			onblur={handleTitleBlur}
			onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
			class="page-title-input"
			placeholder="Untitled"
			spellcheck="false"
		/>
	</form>

	<!-- Tiptap Canvas Container -->
	<div class="editor-canvas-container">
		<!-- Svelte-rendered drop line indicators (immune to ProseMirror DOM re-renders) -->
		{#if dropLineTop !== null}
			<div class="drop-line-indicator" style="top: {dropLineTop}px;"></div>
		{/if}
		{#if dropLineVertical !== null}
			<div class="drop-line-indicator-vertical" style="top: {dropLineVertical.top}px; left: {dropLineVertical.left}px; height: {dropLineVertical.height}px;"></div>
		{/if}
		<!-- Floating Block Gutter Handles (Moved inside the relative canvas wrapper container) -->
		{#if isGutterVisible && !isMobile}
			<div 
				class="block-gutter" 
				style="top: {gutterTop}px; left: {gutterLeft}px;"
			>
				<div 
					class="gutter-btn drag-btn" 
					role="button"
					tabindex="0"
					draggable="true"
					title="Drag to reorder block, or click to open block menu"
					onclick={(e) => {
						e.stopPropagation();
						isActionMenuOpen = !isActionMenuOpen;
					}}
					ondragstart={handleDragStart}
					ondragend={handleDragEnd}
					onkeydown={(e) => e.key === ' ' && (isActionMenuOpen = !isActionMenuOpen)}
				>
					<GripVertical size={14} />
				</div>

				<!-- Floating Block Action Options Dropdown -->
				{#if isActionMenuOpen}
					<div class="block-action-menu">
						<button class="menu-item-action" onclick={deleteActiveBlock}>
							<Trash2 size={13} class="menu-icon" />
							<span>Delete block</span>
						</button>
						<button class="menu-item-action" onclick={duplicateActiveBlock}>
							<Copy size={13} class="menu-icon" />
							<span>Duplicate block</span>
						</button>
						<hr class="menu-divider" />
						<div class="menu-section-label">Turn into</div>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('paragraph')}>
							<Type size={13} class="menu-icon" />
							<span>Text Paragraph</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('heading', 1)}>
							<Heading1 size={13} class="menu-icon" />
							<span>Heading 1</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('heading', 2)}>
							<Heading2 size={13} class="menu-icon" />
							<span>Heading 2</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('heading', 3)}>
							<Heading3 size={13} class="menu-icon" />
							<span>Heading 3</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('blockquote')}>
							<Quote size={13} class="menu-icon" />
							<span>Quote Block</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('codeBlock')}>
							<Code size={13} class="menu-icon" />
							<span>Code Block</span>
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<div bind:this={editorElement} class="tiptap-editor-element"></div>
	</div>
</article>

<style>
	.editor-page {
		position: relative;
		padding-top: 24px;
	}

	/* Floating Gutter handles */
	.block-gutter {
		position: absolute;
		display: flex;
		align-items: center;
		gap: 2px;
		height: 20px;
		z-index: 100;
		user-select: none;
	}

	.gutter-btn {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		cursor: pointer;
		transition: background var(--transition-speed), color var(--transition-speed);
	}

	.gutter-btn:hover {
		background-color: var(--hover-sidebar);
		color: var(--text-main);
	}

	.drag-btn {
		cursor: grab;
	}

	.drag-btn:active {
		cursor: grabbing;
	}

	/* Floating Options Menu */
	.block-action-menu {
		position: absolute;
		top: 24px;
		left: 20px;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
		padding: 6px 4px;
		width: 170px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		z-index: 200;
	}

	:root.dark .block-action-menu {
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
	}

	.menu-item-action {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		width: 100%;
		border-radius: 4px;
		font-size: 13px;
		color: var(--text-main);
		text-align: left;
		cursor: pointer;
		transition: background var(--transition-speed);
	}

	.menu-item-action:hover {
		background-color: var(--hover-sidebar);
	}

	.menu-item-action :global(svg) {
		color: var(--text-muted);
	}

	.menu-divider {
		border: none;
		border-top: 1px solid var(--border-color);
		margin: 4px 0;
	}

	.menu-section-label {
		font-size: 10px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
		padding: 2px 8px 4px;
	}

	/* Autosave Floating indicator */
	.autosave-indicator {
		position: absolute;
		top: -15px;
		right: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
		padding: 4px 8px;
		border-radius: 4px;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		user-select: none;
		pointer-events: none;
		transition: color var(--transition-speed), border-color var(--transition-speed);
	}

	.autosave-indicator.status-saving {
		color: var(--accent-color);
		border-color: var(--accent-color);
	}

	.autosave-indicator.status-error {
		color: var(--error-color);
		border-color: var(--error-color);
	}

	.page-icon-wrapper {
		margin-bottom: 8px;
		user-select: none;
		display: inline-block;
	}

	.icon-input {
		font-size: 78px;
		width: 90px;
		height: 90px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		outline: none;
	}

	.title-form {
		width: 100%;
		margin-bottom: 24px;
	}

	.page-title-input {
		width: 100%;
		font-size: 40px;
		font-weight: 700;
		color: var(--text-main);
		border: none;
		background: transparent;
		outline: none;
		line-height: 1.3;
		padding: 4px 0 8px;
	}

	/* Editor Canvas Styling */
	.editor-canvas-container {
		width: 100%;
		margin-top: 12px;
		position: relative;
	}

	.tiptap-editor-element {
		width: 100%;
		outline: none;
	}

	/* Blue drop target line indicator (Notion-style) — horizontal */
	.drop-line-indicator {
		position: absolute;
		left: 0;
		right: 0;
		height: 3px;
		background-color: var(--accent-color);
		border-radius: 2px;
		z-index: 50;
		pointer-events: none;
		transition: top 0.05s ease;
	}

	/* Blue drop target line indicator — vertical (column creation) */
	.drop-line-indicator-vertical {
		position: absolute;
		width: 3px;
		background-color: var(--accent-color);
		border-radius: 2px;
		z-index: 50;
		pointer-events: none;
		transition: left 0.05s ease, top 0.05s ease;
	}
</style>
