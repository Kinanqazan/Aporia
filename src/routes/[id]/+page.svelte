<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { Editor, Extension } from '@tiptap/core';
	import { Selection, Plugin } from '@tiptap/pm/state';
	import StarterKit from '@tiptap/starter-kit';
	import { ColumnLayout } from '$lib/editor/extensions/ColumnLayout';
	import { Column } from '$lib/editor/extensions/Column';
	import { Commands } from '$lib/editor/extensions/Commands';
	import { TextStyle } from '@tiptap/extension-text-style';
	import { Color } from '@tiptap/extension-color';
	import { Highlight } from '@tiptap/extension-highlight';
	import Details, { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
	import { BubbleMenu } from '@tiptap/extension-bubble-menu';
	import { Link as TiptapLink } from '@tiptap/extension-link';
	import { TaskList } from '@tiptap/extension-task-list';
	import { TaskItem } from '@tiptap/extension-task-item';
	import { Table as TiptapTable } from '@tiptap/extension-table';
	import { TableRow } from '@tiptap/extension-table-row';
	import { TableHeader } from '@tiptap/extension-table-header';
	import { TableCell } from '@tiptap/extension-table-cell';
	import { 
		Cloud, CloudLightning, Plus, GripVertical, Trash2, Copy, 
		Heading1, Heading2, Heading3, Type, Quote, Code, 
		List, ListOrdered, Bold, Italic, Link as LinkIcon, Palette,
		CheckSquare, Minus, Table as TableIcon, ChevronRight, Lock
	} from 'lucide-svelte';

	import { CURATED_ICONS } from '$lib/icons';
	import PageIcon from '$lib/components/PageIcon.svelte';

	let { data } = $props();
	
	let subPages = $derived(
		(data.activePages || [])
			.filter((p: any) => p.parentId === data.pageRecord.id)
			.sort((a: any, b: any) => a.position - b.position)
	);
	
	// Local state bound to input elements for title and icon
	let title = $state(data.pageRecord.title);
	let isLocked = $state(data.pageRecord.isLocked === 1);
	let icon = $state(data.pageRecord.icon || '📄');
	
	let isIconPickerOpen = $state(false);
	let iconInputText = $state('');

	function selectIcon(newIcon: string) {
		if (isLocked) return;
		icon = newIcon.trim();
		isIconPickerOpen = false;
		setTimeout(() => {
			iconForm?.requestSubmit();
		}, 0);
	}
	
	// Tiptap states
	let editorElement = $state<HTMLDivElement>();
	let editor = $state<Editor>();
	let editorPageId = $state<string | null>(null);
	let autosaveStatus = $state<'saved' | 'saving' | 'error'>('saved');
	let autosaveTimeout: any;
	let saveInFlight: Promise<void> | null = null;

	// Bubble Menu elements and states
	let bubbleMenuElement = $state<HTMLDivElement>();
	let isColorMenuOpen = $state(false);

	// Table interaction states
	let isTableHovered = $state(false);
	let activeTableNode = $state<HTMLTableElement | null>(null);
	let tableHoverPosition = $state({ top: 0, left: 0, width: 0, height: 0 });

	function updateTablePositions() {
		if (activeTableNode && editorElement) {
			const tableRect = activeTableNode.getBoundingClientRect();
			const editorRect = editorElement.getBoundingClientRect();
			tableHoverPosition = {
				top: tableRect.top - editorRect.top,
				left: tableRect.left - editorRect.left,
				width: tableRect.width,
				height: tableRect.height
			};
		}
	}

	// Column/Row Handles states
	let activeCellNode = $state<HTMLElement | null>(null);
	let columnHandlePosition = $state({ top: 0, left: 0 });
	let rowHandlePosition = $state({ top: 0, left: 0 });
	let isColMenuOpen = $state(false);
	let isRowMenuOpen = $state(false);
	let colMenuPosition = $state({ top: 0, left: 0 });
	let rowMenuPosition = $state({ top: 0, left: 0 });

	function handleColumnHandleClick(e: MouseEvent) {
		e.stopPropagation();
		if (!editor || !activeCellNode) return;
		
		// Focus editor and select the cell
		editor.commands.focus();
		const pos = editor.view.posAtDOM(activeCellNode, 0);
		editor.commands.setTextSelection(pos);
		
		colMenuPosition = {
			top: columnHandlePosition.top + 16,
			left: columnHandlePosition.left
		};
		isColMenuOpen = true;
		isRowMenuOpen = false;
	}

	function handleRowHandleClick(e: MouseEvent) {
		e.stopPropagation();
		if (!editor || !activeCellNode) return;
		
		// Focus editor and select the cell
		editor.commands.focus();
		const pos = editor.view.posAtDOM(activeCellNode, 0);
		editor.commands.setTextSelection(pos);
		
		rowMenuPosition = {
			top: rowHandlePosition.top,
			left: rowHandlePosition.left + 16
		};
		isRowMenuOpen = true;
		isColMenuOpen = false;
	}

	// Slash Command states
	let isSlashMenuOpen = $state(false);
	let slashMenuPosition = $state({ top: 0, left: 0 });
	let slashQuery = $state('');
	let slashSelectedIndex = $state(0);
	let slashCommandCallback = $state<((props: any) => void) | null>(null);

	const colors = [
		{ name: 'Default', value: 'var(--text-main)' },
		{ name: 'Gray', value: 'var(--color-gray)' },
		{ name: 'Brown', value: 'var(--color-brown)' },
		{ name: 'Orange', value: 'var(--color-orange)' },
		{ name: 'Yellow', value: 'var(--color-yellow)' },
		{ name: 'Green', value: 'var(--color-green)' },
		{ name: 'Blue', value: 'var(--color-blue)' },
		{ name: 'Purple', value: 'var(--color-purple)' },
		{ name: 'Pink', value: 'var(--color-pink)' },
		{ name: 'Red', value: 'var(--color-red)' }
	];

	const highlights = [
		{ name: 'Default', value: 'transparent' },
		{ name: 'Gray background', value: 'var(--bg-gray)' },
		{ name: 'Brown background', value: 'var(--bg-brown)' },
		{ name: 'Orange background', value: 'var(--bg-orange)' },
		{ name: 'Yellow background', value: 'var(--bg-yellow)' },
		{ name: 'Green background', value: 'var(--bg-green)' },
		{ name: 'Blue background', value: 'var(--bg-blue)' },
		{ name: 'Purple background', value: 'var(--bg-purple)' },
		{ name: 'Pink background', value: 'var(--bg-pink)' },
		{ name: 'Red background', value: 'var(--bg-red)' }
	];

	// Details is Tiptap's MIT-licensed toggle node. The summary remains a native
	// <summary> for accessibility while this attribute gives us Notion-style H1-H3
	// visual variants.
	const ToggleHeading = Details.extend({
		addAttributes() {
			return {
				...(this.parent?.() ?? {}),
				level: {
					default: 1,
					parseHTML: (element) => Number(element.getAttribute('data-heading-level')) || 1,
					renderHTML: (attributes) => ({ 'data-heading-level': attributes.level })
				}
			};
		},
		addNodeView() {
			const createDetailsNodeView = this.parent?.();
			if (!createDetailsNodeView) return null;

			return (props) => {
				const detailsNodeView = createDetailsNodeView(props);
				if (!detailsNodeView) return detailsNodeView;
				
				const updateHeadingLevel = (node: typeof props.node) => {
					detailsNodeView.dom.setAttribute('data-heading-level', String(node.attrs.level));
				};
				updateHeadingLevel(props.node);

				const parentUpdate = detailsNodeView.update?.bind(detailsNodeView);

				return {
					...detailsNodeView,
					update: (updatedNode, decorations, innerDecorations) => {
						const didUpdate = parentUpdate?.(updatedNode, decorations, innerDecorations) ?? true;
						if (didUpdate) {
							updateHeadingLevel(updatedNode);
						}
						return didUpdate;
					}
				};
			};
		}
	});

	const PreserveDetailsLevel = Extension.create({
		name: 'preserveDetailsLevel',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					appendTransaction(transactions, oldState, newState) {
						// A user-initiated level change must win over the compatibility
						// preservation below. Without this guard, H3 -> H1 is immediately
						// changed back to H3.
						if (transactions.some((transaction) => transaction.getMeta('toggleHeadingLevelChange'))) {
							return null;
						}

						let tr = newState.tr;
						let modified = false;

						newState.doc.descendants((node, pos) => {
							if (node.type.name === 'details') {
								const oldNode = oldState.doc.nodeAt(pos);
								if (oldNode && oldNode.type.name === 'details') {
									if (node.attrs.level !== oldNode.attrs.level && node.attrs.level === 1) {
										tr = tr.setNodeMarkup(pos, undefined, {
											...node.attrs,
											level: oldNode.attrs.level
										});
										modified = true;
									}
								}
							}
						});

						return modified ? tr : null;
					}
				})
			];
		}
	});

	function setToggleHeading(editor: Editor, range: { from: number; to: number }, level: 1 | 2 | 3) {
		editor
			.chain()
			.focus()
			.deleteRange(range)
			.setDetails()
			.updateAttributes('details', { level })
			.run();
	}

	const slashItems = [
		{
			title: 'Text',
			description: 'Start writing with plain text.',
			searchTerms: ['text', 'p', 'paragraph', 'normal'],
			icon: Type,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).setParagraph().run();
			}
		},
		{
			title: 'Heading 1',
			description: 'Big section heading.',
			searchTerms: ['h1', 'heading', 'large'],
			icon: Heading1,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
			}
		},
		{
			title: 'Heading 2',
			description: 'Medium section heading.',
			searchTerms: ['h2', 'heading', 'medium'],
			icon: Heading2,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run();
			}
		},
		{
			title: 'Heading 3',
			description: 'Small section heading.',
			searchTerms: ['h3', 'heading', 'small'],
			icon: Heading3,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleHeading({ level: 3 }).run();
			}
		},
		{
			title: 'Toggle Heading 1',
			description: 'Large collapsible section.',
			searchTerms: ['toggle', 'collapsible', 'details', 'h1'],
			icon: ChevronRight,
			action: (editor: Editor, range: any) => setToggleHeading(editor, range, 1)
		},
		{
			title: 'Toggle Heading 2',
			description: 'Medium collapsible section.',
			searchTerms: ['toggle', 'collapsible', 'details', 'h2'],
			icon: ChevronRight,
			action: (editor: Editor, range: any) => setToggleHeading(editor, range, 2)
		},
		{
			title: 'Toggle Heading 3',
			description: 'Small collapsible section.',
			searchTerms: ['toggle', 'collapsible', 'details', 'h3'],
			icon: ChevronRight,
			action: (editor: Editor, range: any) => setToggleHeading(editor, range, 3)
		},
		{
			title: 'Bullet List',
			description: 'Create a simple bulleted list.',
			searchTerms: ['bullet', 'list', 'ul'],
			icon: List,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleBulletList().run();
			}
		},
		{
			title: 'Numbered List',
			description: 'Create a list with numbering.',
			searchTerms: ['number', 'list', 'ol', 'ordered'],
			icon: ListOrdered,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleOrderedList().run();
			}
		},
		{
			title: 'Blockquote',
			description: 'Capture a quote.',
			searchTerms: ['quote', 'blockquote'],
			icon: Quote,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleBlockquote().run();
			}
		},
		{
			title: 'Code Block',
			description: 'Write code snippets.',
			searchTerms: ['code', 'block', 'pre'],
			icon: Code,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
			}
		},
		{
			title: 'To-do List',
			description: 'Track tasks with checkboxes.',
			searchTerms: ['todo', 'task', 'checklist', 'checkbox'],
			icon: CheckSquare,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).toggleTaskList().run();
			}
		},
		{
			title: 'Divider',
			description: 'Visually divide sections with a line.',
			searchTerms: ['divider', 'hr', 'horizontal', 'line'],
			icon: Minus,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).setHorizontalRule().run();
			}
		},
		{
			title: 'Table',
			description: 'Insert a simple 3x3 table.',
			searchTerms: ['table', 'grid', 'cells'],
			icon: TableIcon,
			action: (editor: Editor, range: any) => {
				editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
			}
		}
	];

	let filteredItems = $derived(
		slashItems.filter(item => {
			const query = slashQuery.toLowerCase();
			return item.title.toLowerCase().includes(query) ||
				item.searchTerms.some(term => term.includes(query));
		})
	);

	function triggerSelectedCommand() {
		if (filteredItems.length > 0 && slashCommandCallback) {
			const item = filteredItems[slashSelectedIndex];
			slashCommandCallback({
				command: ({ editor, range }: any) => {
					item.action(editor, range);
				}
			});
		}
		isSlashMenuOpen = false;
	}

	function handleSlashItemClick(item: typeof slashItems[0]) {
		if (slashCommandCallback) {
			slashCommandCallback({
				command: ({ editor, range }: any) => {
					item.action(editor, range);
				}
			});
		}
		isSlashMenuOpen = false;
	}

	function setLink() {
		if (!editor) return;
		const previousUrl = editor.getAttributes('link').href;
		const url = window.prompt('Enter link URL:', previousUrl || 'https://');
		
		// If cancelled
		if (url === null) return;
		
		// If empty, remove link
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}

		editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
	}

	function handleTitleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			(e.currentTarget as HTMLInputElement).blur();
			if (editor) {
				const firstNode = editor.state.doc.firstChild;
				if (!firstNode || (firstNode.type.name === 'paragraph' && firstNode.content.size === 0)) {
					editor.chain().focus().run();
				} else {
					editor.chain().insertContentAt(0, { type: 'paragraph' }).focus('start').run();
				}
			}
		}
	}

	// Floating block gutter states
	let activeBlockNode = $state<HTMLElement | null>(null);
	let isGutterVisible = $state(false);
	let gutterTop = $state(0);
	let gutterLeft = $state(0);
	let isActionMenuOpen = $state(false);
	let openUpward = $state(false);
	const GUTTER_HIT_SLOP = 36;
	
	// Drag state
	let dragExpandTimeout: any = null;
	let lastDragTargetDetails: HTMLElement | null = null;
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
		detailsChildIndex?: number;
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
		isLocked = data.pageRecord.isLocked === 1;

		// Flush any pending save for the previous page immediately before switching.
		// This preserves the last edit even if the user navigates before the 1s debounce.
		clearTimeout(autosaveTimeout);
		flushPendingSave();
		
		if (editor && editorPageId !== data.pageRecord.id) {
			editor.destroy();
			editor = undefined;
			editorElement?.replaceChildren();
			createEditor();
			return;
		}

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
				editor.commands.setContent(serverJson, { emitUpdate: false });
			}
		}
	});

	// Highlight and scroll to matching term if requested
	$effect(() => {
		const highlightQuery = $page.url.searchParams.get('highlight');
		if (editor && highlightQuery) {
			setTimeout(() => {
				if (!editor) return;
				const text = highlightQuery.trim();
				if (!text) return;

				// Strip the ?highlight= param from the URL immediately so refresh won't re-trigger
				const cleanUrl = window.location.pathname;
				history.replaceState({}, '', cleanUrl);

				// Find the first text node in the editor that contains the term
				let pos = -1;
				editor.state.doc.descendants((node, nodePos) => {
					if (node.isText && node.text && pos === -1) {
						const textIdx = node.text.toLowerCase().indexOf(text.toLowerCase());
						if (textIdx !== -1) {
							pos = nodePos + textIdx;
							return false;
						}
					}
				});

				if (pos !== -1) {
					editor.commands.focus();

					// Open any collapsed details/toggle blocks that contain this position
					const resolved = editor.state.doc.resolve(pos);
					const tr = editor.state.tr;
					let updated = false;
					for (let depth = 1; depth <= resolved.depth; depth++) {
						const node = resolved.node(depth);
						if (node.type.name === 'details' && !node.attrs.open) {
							tr.setNodeMarkup(resolved.before(depth), undefined, { ...node.attrs, open: true });
							updated = true;
						}
					}
					if (updated) editor.view.dispatch(tr);

					// Select the matching text and scroll it into view
					editor.commands.setTextSelection({ from: pos, to: pos + text.length });

					// Wait one frame for toggle expand to layout, then scroll the canvas
					setTimeout(() => {
						const sel = window.getSelection();
						if (sel && sel.rangeCount > 0) {
							const rect = sel.getRangeAt(0).getBoundingClientRect();
							const scrollContainer = editorElement?.closest('.canvas-wrapper');
							if (scrollContainer) {
								const relativeTop = rect.top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop;
								scrollContainer.scrollTo({ top: relativeTop - 120, behavior: 'smooth' });
							}
						}
					}, 60);
				}
			}, 200);
		}
	});

	function createEditor() {
		// BubbleMenu v3 uses Floating UI. Its default absolute positioning is relative
		// to the editor container and can lag behind a nested scrolling canvas, which
		// makes the first selection appear away from the selected text.
		const bubbleMenuScrollTarget =
			editorElement?.closest<HTMLElement>('.canvas-wrapper') ?? window;

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
			editable: !data.pageRecord.isLocked,
			extensions: [
				StarterKit.configure({
					heading: {
						levels: [1, 2, 3]
					}
				}),
				ToggleHeading.configure({
					persist: true
				}),
				PreserveDetailsLevel,
				DetailsSummary,
				DetailsContent,
				ColumnLayout,
				Column,
				TextStyle,
				Color,
				Highlight.configure({ multicolor: true }),
				TiptapLink.configure({
					openOnClick: false,
					HTMLAttributes: {
						class: 'editor-link'
					}
				}),
				TaskList,
				TaskItem.configure({
					nested: true
				}),
				TiptapTable.configure({
					resizable: true
				}),
				TableRow,
				TableHeader,
				TableCell,
				BubbleMenu.configure({
					element: bubbleMenuElement,
					// Do not debounce the first selection: its rect is the anchor for this menu.
					updateDelay: 0,
					resizeDelay: 0,
					options: {
						placement: 'top',
						strategy: 'fixed',
						offset: 8,
						inline: true,
						scrollTarget: bubbleMenuScrollTarget
					}
				}),
				Commands.configure({
					suggestion: {
						char: '/',
						render: () => {
							return {
								onStart: (props) => {
									isSlashMenuOpen = true;
									slashQuery = props.query;
									slashSelectedIndex = 0;
									slashCommandCallback = props.command;

									if (props.clientRect && editorElement) {
										const rect = props.clientRect();
										if (rect) {
											const editorRect = editorElement.getBoundingClientRect();
											slashMenuPosition = {
												top: rect.bottom - editorRect.top + 6,
												left: rect.left - editorRect.left
											};
										}
									}
								},
								onUpdate: (props) => {
									slashQuery = props.query;
									slashSelectedIndex = 0;
									slashCommandCallback = props.command;

									if (props.clientRect && editorElement) {
										const rect = props.clientRect();
										if (rect) {
											const editorRect = editorElement.getBoundingClientRect();
											slashMenuPosition = {
												top: rect.bottom - editorRect.top + 6,
												left: rect.left - editorRect.left
											};
										}
									}
								},
								onKeyDown: (props) => {
									if (props.event.key === 'ArrowUp') {
										slashSelectedIndex = (slashSelectedIndex - 1 + filteredItems.length) % filteredItems.length;
										return true;
									}
									if (props.event.key === 'ArrowDown') {
										slashSelectedIndex = (slashSelectedIndex + 1) % filteredItems.length;
										return true;
									}
									if (props.event.key === 'Enter') {
										triggerSelectedCommand();
										return true;
									}
									if (props.event.key === 'Escape') {
										isSlashMenuOpen = false;
										return true;
									}
									return false;
								},
								onExit: () => {
									isSlashMenuOpen = false;
									slashCommandCallback = null;
								}
							};
						}
					}
				})
			],
			content: initialContent,
			editorProps: {
				attributes: {
					class: 'tiptap-content-canvas'
				},
				handleKeyDown: (view, event) => {
					if (event.key === 'Enter' && !event.shiftKey) {
						const { state } = view;
						const { selection } = state;
						const { empty } = selection;
						if (empty) {
							const fromNode = selection.$from;
							const parent = fromNode.parent;
							if (parent.type.name === 'detailsSummary') {
								if (fromNode.parentOffset === 0) {
									const detailsNodeDepth = fromNode.depth - 1;
									const detailsStartPos = fromNode.before(detailsNodeDepth);
									const tr = state.tr.insert(detailsStartPos, view.state.schema.nodes.paragraph.create());
									view.dispatch(tr);
									event.preventDefault();
									return true;
								}
							}
						}
					}
					return false;
				}
			},
			onUpdate: ({ editor }) => {
				const jsonContent = editor.getJSON();
				const jsonStr = JSON.stringify(jsonContent);
				triggerAutosave(jsonStr);
			}
		});

		editorPageId = data.pageRecord.id;
	}

	$effect(() => {
		editor?.setEditable(!isLocked);
		if (isLocked) {
			isIconPickerOpen = false;
			isSlashMenuOpen = false;
		}
	});

	onMount(() => {
		createEditor();
		const handlePageHide = () => {
			void flushPendingSave({ keepalive: true });
		};

		// Listen to global mousemoves to position the floating gutter block handle
		window.addEventListener('mousemove', handleMouseMove);
		window.addEventListener('click', handleGlobalClick);
		window.addEventListener('dragover', handleDragOver, { capture: true });
		window.addEventListener('drop', handleDrop, { capture: true });
		
		handleResize();
		window.addEventListener('resize', handleResize);
		window.addEventListener('pagehide', handlePageHide);

		return () => {
			window.removeEventListener('pagehide', handlePageHide);
		};
	});

	onDestroy(() => {
		void flushPendingSave({ keepalive: true });
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
		const target = e.target as HTMLElement;

		// If we are already hovering a table, check if mouse is still near it
		if (activeTableNode && isTableHovered) {
			const rect = activeTableNode.getBoundingClientRect();
			// Allow a slop of 40px to the right and bottom for the adder tracks/buttons,
			// and 30px to the top and left for handles, to make interaction smooth.
			const isNearTable = 
				e.clientX >= rect.left - 30 &&
				e.clientX <= rect.right + 45 &&
				e.clientY >= rect.top - 30 &&
				e.clientY <= rect.bottom + 45;
			
			if (isNearTable) {
				isGutterVisible = false;
				// Update table positions in case it resized
				tableHoverPosition = {
					top: rect.top - editorRect.top,
					left: rect.left - editorRect.left,
					width: rect.width,
					height: rect.height
				};

				// Update handles to currently hovered cell inside table
				const cell = target.closest('td, th') as HTMLElement | null;
				if (cell) {
					activeCellNode = cell;
					const cellRect = cell.getBoundingClientRect();
					columnHandlePosition = {
						left: cellRect.left - editorRect.left + (cellRect.width / 2) - 12,
						top: rect.top - editorRect.top - 12
					};
					rowHandlePosition = {
						left: rect.left - editorRect.left - 12,
						top: cellRect.top - editorRect.top + (cellRect.height / 2) - 12
					};
				}
				return;
			}
		}

		// Check if mouse is hovering over a table cell (td/th)
		const cell = target.closest('td, th') as HTMLElement | null;
		const table = cell?.closest('table') as HTMLTableElement | null;

		if (table && cell) {
			activeTableNode = table;
			activeCellNode = cell;
			const tableRect = table.getBoundingClientRect();
			const cellRect = cell.getBoundingClientRect();
			
			tableHoverPosition = {
				top: tableRect.top - editorRect.top,
				left: tableRect.left - editorRect.left,
				width: tableRect.width,
				height: tableRect.height
			};
			
			// Position column handle centered above the cell
			columnHandlePosition = {
				left: cellRect.left - editorRect.left + (cellRect.width / 2) - 12,
				top: tableRect.top - editorRect.top - 12
			};
			
			// Position row handle centered to the left of the cell
			rowHandlePosition = {
				left: tableRect.left - editorRect.left - 12,
				top: cellRect.top - editorRect.top + (cellRect.height / 2) - 12
			};

			isTableHovered = true;
			isGutterVisible = false;
			return;
		} else {
			isTableHovered = false;
			activeTableNode = null;
			activeCellNode = null;
		}
		
		// Keep the current handle alive while the pointer crosses the gap between
		// the block and its dots, so it remains clickable.
		if (isGutterVisible &&
			e.clientX >= editorRect.left + gutterLeft - 8 &&
			e.clientX <= editorRect.left + gutterLeft + 28 &&
			e.clientY >= editorRect.top + gutterTop - 8 &&
			e.clientY <= editorRect.top + gutterTop + 32) {
			return;
		}

		// Ensure mouse is horizontally near the editor bounds.
		if (e.clientX < editorRect.left - 60 || e.clientX > editorRect.right + 20) {
			isGutterVisible = false;
			return;
		}

		// Find any block node at the cursor Y — including blocks inside columns
		// Filter out column-layout and column wrapper divs BEFORE find(),
		// otherwise the wrapper's bounding rect matches first and steals the hit.
		const allBlocks = Array.from(editorElement.querySelectorAll(
			'.ProseMirror > *, .ProseMirror > .column-layout > .column > *, .ProseMirror > [data-type="details"] > div > [data-type="detailsContent"] > *'
		)).filter(node => {
			const el = node as HTMLElement;
			return !el.classList.contains('column-layout') && !el.classList.contains('column');
		});
		const blocksAtY = allBlocks.filter(node => {
			const rect = node.getBoundingClientRect();
			return e.clientY >= rect.top - 2 &&
				e.clientY <= rect.bottom + 2;
		});
		const blockAtPointer = blocksAtY.find(node => {
			const rect = node.getBoundingClientRect();
			return e.clientX >= rect.left && e.clientX <= rect.right;
		});
		// Details contains both the parent toggle and its editable children. Prefer
		// the direct child under the pointer so its dots can turn it into a quote,
		// list, or another supported block type.
		const nestedBlockAtPointer = blocksAtY.find(node => {
			const rect = node.getBoundingClientRect();
			return node.parentElement?.matches('[data-type="detailsContent"]') &&
				e.clientX >= rect.left && e.clientX <= rect.right;
		});
		const block = nestedBlockAtPointer ?? blockAtPointer ?? blocksAtY
			.map(node => ({ node, distance: Math.abs(e.clientX - (node.getBoundingClientRect().left - 28)) }))
			.filter(({ distance }) => distance <= GUTTER_HIT_SLOP)
			.sort((a, b) => a.distance - b.distance)[0]?.node;

		if (block && block instanceof HTMLElement) {
			activeBlockNode = block;
			const toggleSummary = block.matches('[data-type="details"]')
				? block.querySelector<HTMLElement>('summary')
				: null;
			const handleAnchorRect = (toggleSummary ?? block).getBoundingClientRect();
			
			// A toggle's drag handle belongs beside its summary, not midway down its
			// expanded content. This matches Notion's heading-row interaction.
			gutterTop = handleAnchorRect.top - editorRect.top + (handleAnchorRect.height / 2) - 12;
			gutterLeft = handleAnchorRect.left - editorRect.left - 28;
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
		if (!target.closest('.color-picker-dropdown') && !target.closest('.bubble-color-btn')) {
			isColorMenuOpen = false;
		}
		if (!target.closest('.table-handle-menu') && !target.closest('.table-col-handle') && !target.closest('.table-row-handle')) {
			isColMenuOpen = false;
			isRowMenuOpen = false;
		}
	}

	// Holds the content and page ID for any pending unsaved edit.
	let pendingSave: { pageId: string; contentJson: string } | null = null;

	async function flushPendingSave(options: { keepalive?: boolean } = {}) {
		while (saveInFlight || pendingSave) {
			if (saveInFlight) {
				await saveInFlight;
				continue;
			}

			const save = pendingSave;
			if (!save) continue;
			pendingSave = null;
			saveInFlight = (async () => {
				const controller = new AbortController();
				const timeoutId = setTimeout(() => controller.abort(), 5000);
				try {
					const response = await fetch(`/api/pages/${save.pageId}`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ contentJson: save.contentJson }),
						keepalive: options.keepalive,
						signal: controller.signal
					});
					const result = await response.json();
					autosaveStatus = result.success ? 'saved' : 'error';
				} catch (err) {
					console.error('Autosave failed:', err);
					autosaveStatus = 'error';
				} finally {
					clearTimeout(timeoutId);
				}
			})();

			try {
				await saveInFlight;
			} finally {
				saveInFlight = null;
			}
		}
	}

	function triggerAutosave(contentJson: string) {
		// Read-only pages must never queue or send content updates. This also
		// prevents a stale editor transaction from turning the status back to
		// "Saving..." immediately after a page is locked.
		if (isLocked) {
			return;
		}
		autosaveStatus = 'saving';
		// Capture page ID immediately so a navigation mid-debounce can't corrupt another page
		pendingSave = { pageId: data.pageRecord.id, contentJson };
		clearTimeout(autosaveTimeout);
		autosaveTimeout = setTimeout(flushPendingSave, 1000);
	}

	let titleForm: HTMLFormElement;
	let iconForm: HTMLFormElement;

	function handleTitleBlur() {
		if (title !== data.pageRecord.title) {
			titleForm.requestSubmit();
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

		// Blocks directly inside a toggle's DetailsContent are a separate JSON
		// container and need their own child index for drag reordering.
		const detailsContentEl = activeBlockNode.parentElement?.matches('[data-type="detailsContent"]')
			? activeBlockNode.parentElement
			: null;
		const detailsEl = detailsContentEl?.closest<HTMLElement>('[data-type="details"]');
		if (detailsContentEl && detailsEl) {
			const detailsTopIndex = topNodes.indexOf(detailsEl);
			const detailsChildIndex = Array.from(detailsContentEl.children).indexOf(activeBlockNode);
			if (detailsTopIndex !== -1 && detailsChildIndex !== -1) {
				return { topIndex: detailsTopIndex, detailsChildIndex };
			}
		}

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

	function getBlockPathForElement(block: HTMLElement): BlockPath | null {
		if (!editorElement) return null;
		const topNodes = Array.from(editorElement.querySelector('.ProseMirror')?.children || []);
		const topIndex = topNodes.indexOf(block);
		if (topIndex !== -1) return { topIndex };

		const detailsContentEl = block.parentElement?.matches('[data-type="detailsContent"]')
			? block.parentElement
			: null;
		const detailsEl = detailsContentEl?.closest<HTMLElement>('[data-type="details"]');
		if (detailsContentEl && detailsEl) {
			const detailsTopIndex = topNodes.indexOf(detailsEl);
			const detailsChildIndex = Array.from(detailsContentEl.children).indexOf(block);
			if (detailsTopIndex !== -1 && detailsChildIndex !== -1) {
				return { topIndex: detailsTopIndex, detailsChildIndex };
			}
		}

		const columnEl = block.closest('[data-type="column"]');
		const layoutEl = columnEl?.closest('[data-type="columnLayout"]');
		if (!columnEl || !layoutEl) return null;
		const layoutTopIndex = topNodes.indexOf(layoutEl);
		const columnIndex = Array.from(layoutEl.children).indexOf(columnEl);
		const childIndex = Array.from(columnEl.children).indexOf(block);
		return layoutTopIndex !== -1 && columnIndex !== -1 && childIndex !== -1
			? { topIndex: layoutTopIndex, columnIndex, childIndex }
			: null;
	}

	function sameBlockPath(a: BlockPath, b: BlockPath): boolean {
		return a.topIndex === b.topIndex &&
			a.columnIndex === b.columnIndex &&
			a.childIndex === b.childIndex &&
			a.detailsChildIndex === b.detailsChildIndex;
	}

	function getDragTargetBlock(e: DragEvent): HTMLElement | null {
		if (!editorElement) return null;
		const candidates = Array.from(editorElement.querySelectorAll(
			'.ProseMirror > *, .ProseMirror > [data-type="details"] > div > [data-type="detailsContent"] > *'
		)).filter((node): node is HTMLElement => node instanceof HTMLElement);
		const atPointer = candidates.filter(node => {
			const rect = node.getBoundingClientRect();
			return e.clientY >= rect.top && e.clientY <= rect.bottom &&
				e.clientX >= rect.left && e.clientX <= rect.right;
		});
		return atPointer.find(node => node.parentElement?.matches('[data-type="detailsContent"]')) ?? atPointer[0] ?? null;
	}

	function deleteActiveBlock() {
		if (!editor || !activeBlockNode) return;
		const index = getActiveBlockIndex();
		if (index === -1) return;

		// Select the block node in Tiptap transaction and delete it
		editor.commands.focus();
		
		// Calculate position bounds
		let currentPos = -1;
		let nodeSize = 0;
		editor.state.doc.descendants((node, pos) => {
			if (node.isBlock && node.type.name !== 'doc' && currentPos === -1) {
					const domNode = editor!.view.nodeDOM(pos);
				if (domNode === activeBlockNode) {
					currentPos = pos;
					nodeSize = node.nodeSize;
				}
			}
			return true;
		});

		if (currentPos !== -1) {
			editor.commands.deleteRange({ from: currentPos, to: currentPos + nodeSize });
		} else {
			const pos = editor.view.posAtDOM(activeBlockNode, 0);
			const resolvedPos = editor.state.doc.resolve(pos);
			const node = resolvedPos.nodeAfter || resolvedPos.nodeBefore;
			if (node) {
				editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize });
			} else {
				editor.commands.setTextSelection(pos);
				editor.commands.selectNodeBackward();
				editor.commands.deleteSelection();
			}
		}

		isActionMenuOpen = false;
		isGutterVisible = false;
	}

	function duplicateActiveBlock() {
		if (!editor || !activeBlockNode) return;
		const path = getActiveBlockPath();
		if (!path) return;

		const docJson: any = JSON.parse(JSON.stringify(editor.getJSON()));
		let container: any[] | undefined;
		let index = -1;

		if (path.detailsChildIndex !== undefined) {
			const detailsContent = docJson.content?.[path.topIndex]?.content?.find(
				(node: any) => node.type === 'detailsContent'
			);
			container = detailsContent?.content;
			index = path.detailsChildIndex;
		} else if (path.columnIndex !== undefined && path.childIndex !== undefined) {
			container = docJson.content?.[path.topIndex]?.content?.[path.columnIndex]?.content;
			index = path.childIndex;
		} else {
			container = docJson.content;
			index = path.topIndex;
		}

		if (container?.[index]) {
			container.splice(index + 1, 0, JSON.parse(JSON.stringify(container[index])));
			editor.commands.setContent(docJson, { emitUpdate: true });
		}

		isActionMenuOpen = false;
		isGutterVisible = false;
	}

	function turnActiveBlockIntoToggleHeading(level: 1 | 2 | 3) {
		if (!editor || !activeBlockNode) return;
		const activeBlock = getActiveBlock();
		if (!activeBlock) return;

		// Changing the level of an existing toggle must only update its attribute.
		// Rebuilding it would turn the nested blocks into a new, empty toggle body.
		if (activeBlock.node.type.name === 'details') {
			editor.chain().focus().command(({ tr }) => {
				tr.setMeta('toggleHeadingLevelChange', true);
				tr.setNodeMarkup(activeBlock.pos, undefined, {
					...activeBlock.node.attrs,
					level
				});
				return true;
			}).run();
			return;
		}

		const { pos, node: activeNode } = activeBlock;

		const { schema } = editor.state;
		const summaryContent = activeNode.isTextblock
			? activeNode.content
			: activeNode.textContent
				? schema.text(activeNode.textContent)
				: undefined;
		const summary = schema.nodes.detailsSummary.create(null, summaryContent);
		const content = schema.nodes.detailsContent.create(null, schema.nodes.paragraph.create());
		const toggle = schema.nodes.details.create({ level }, [summary, content]);
		const cursorPosition = pos + 2 + summary.content.size;

		editor
			.chain()
			.focus()
			.command(({ tr }) => {
				tr.replaceWith(pos, pos + activeNode.nodeSize, toggle);
				return true;
			})
			.setTextSelection(cursorPosition)
			.run();
	}

	function getActiveBlock(): { pos: number; node: NonNullable<ReturnType<Editor['state']['doc']['nodeAt']>> } | null {
		if (!editor || !activeBlockNode) return null;
		let exactMatch: { pos: number; node: NonNullable<ReturnType<Editor['state']['doc']['nodeAt']>> } | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (!exactMatch && editor?.view.nodeDOM(pos) === activeBlockNode) {
				exactMatch = { pos, node };
				return false;
			}
			return true;
		});
		if (exactMatch) return exactMatch;

		const domPosition = editor.view.posAtDOM(activeBlockNode, 0);
		const candidatePositions = new Set<number>([domPosition, domPosition - 1]);
		const resolvedPosition = editor.state.doc.resolve(domPosition);

		// `posAtDOM` points inside node views such as Details. Add every enclosing
		// node boundary, then match it back to the exact DOM element that the user
		// hovered. This is safe for top-level blocks, columns, and toggle children.
		for (let depth = resolvedPosition.depth; depth > 0; depth -= 1) {
			candidatePositions.add(resolvedPosition.before(depth));
		}

		for (const pos of candidatePositions) {
			if (pos < 0) continue;
			const node = editor.state.doc.nodeAt(pos);
			if (node && editor.view.nodeDOM(pos) === activeBlockNode) {
				return { pos, node };
			}
		}

		return null;
	}

	function selectActiveBlockContent(): boolean {
		if (!editor) return false;
		const activeBlock = getActiveBlock();
		if (!activeBlock) return false;

		// Find the first editable text position inside the exact node selected by
		// its gutter. This works for nested quotes, lists, and toggle children.
		const selection = Selection.findFrom(editor.state.doc.resolve(activeBlock.pos), 1, true);
		if (!selection) return false;
		editor.view.dispatch(editor.state.tr.setSelection(selection));
		return true;
	}

	function convertActiveBlockTo(type: 'paragraph' | 'heading' | 'toggleHeading' | 'blockquote' | 'codeBlock' | 'todoList' | 'divider' | 'table', level?: number) {
		if (!editor || !activeBlockNode) return;
		editor.commands.focus();

		if (type === 'toggleHeading' && level) {
			turnActiveBlockIntoToggleHeading(level as 1 | 2 | 3);
		} else if (!selectActiveBlockContent()) {
			return;
		} else if (type === 'paragraph') {
			// "Text paragraph" means removing a quote wrapper, not merely changing
			// its already-paragraph child into another paragraph.
			if (editor.isActive('blockquote')) {
				editor.commands.toggleBlockquote();
			} else {
				editor.commands.setParagraph();
			}
		} else if (type === 'heading' && level) {
			editor.commands.toggleHeading({ level: level as any });
		} else if (type === 'blockquote') {
			editor.commands.toggleBlockquote();
		} else if (type === 'codeBlock') {
			editor.commands.toggleCodeBlock();
		} else if (type === 'todoList') {
			editor.commands.toggleTaskList();
		} else if (type === 'divider') {
			editor.commands.setHorizontalRule();
		} else if (type === 'table') {
			editor.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true });
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
		clearTimeout(dragExpandTimeout);
		lastDragTargetDetails = null;
	}

	/** Edge detection threshold in px — how close to left/right edge triggers column mode */
	const COLUMN_EDGE_THRESHOLD = 80;
	const MAX_COLUMNS = 5;

	function handleDragOver(e: DragEvent) {
		if (draggedBlockIndex === null || !editorElement) return;
		e.preventDefault();
		e.stopPropagation();

		const editorRect = editorElement.getBoundingClientRect();

		const targetBlock = getDragTargetBlock(e);
		
		if (!targetBlock) { 
			dropLineTop = null; 
			dropLineVertical = null; 
			clearTimeout(dragExpandTimeout);
			lastDragTargetDetails = null;
			return; 
		}

		// Expand details toggle on hover
		if (targetBlock.matches('[data-type="details"]')) {
			if (lastDragTargetDetails !== targetBlock) {
				clearTimeout(dragExpandTimeout);
				lastDragTargetDetails = targetBlock;
				if (!targetBlock.classList.contains('is-open')) {
					dragExpandTimeout = setTimeout(() => {
						if (lastDragTargetDetails === targetBlock) {
							targetBlock.querySelector('button')?.click();
						}
					}, 500);
				}
			}
		} else {
			clearTimeout(dragExpandTimeout);
			lastDragTargetDetails = null;
		}

		const targetPath = getBlockPathForElement(targetBlock);
		if (!targetPath || !draggedBlockPath || sameBlockPath(targetPath, draggedBlockPath)) {
			dropLineTop = null;
			dropLineVertical = null;
			return;
		}
		const targetIndex = targetPath.topIndex;

		const rect = targetBlock.getBoundingClientRect();
		const relativeX = e.clientX - rect.left;
		const relativeY = e.clientY - rect.top;

		// Check if cursor is near the left or right edge → horizontal column drop
		const isNearLeftEdge = relativeX < COLUMN_EDGE_THRESHOLD;
		const isNearRightEdge = relativeX > (rect.width - COLUMN_EDGE_THRESHOLD);

		if ((isNearLeftEdge || isNearRightEdge) &&
			draggedBlockPath.detailsChildIndex === undefined && targetPath.detailsChildIndex === undefined) {
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
		if (path.detailsChildIndex !== undefined) {
			const details = docContent[path.topIndex];
			const detailsContent = details?.content?.find((node: any) => node.type === 'detailsContent');
			if (!detailsContent?.content) return undefined;
			return detailsContent.content.splice(path.detailsChildIndex, 1)[0];
		}
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

		const targetBlock = getDragTargetBlock(e);

		if (!targetBlock) { handleDragEnd(); return; }
		const targetPath = getBlockPathForElement(targetBlock);
		if (!targetPath || sameBlockPath(targetPath, draggedBlockPath)) { handleDragEnd(); return; }
		const targetIndex = targetPath.topIndex;

		// Reorder direct children of the same toggle without extracting them into
		// the top-level document. Toggle content remains inside DetailsContent.
		if (draggedBlockPath.detailsChildIndex !== undefined &&
			targetPath.detailsChildIndex !== undefined &&
			draggedBlockPath.topIndex === targetPath.topIndex) {
			const docJson: any = editor.getJSON();
			const detailsContent = docJson.content?.[draggedBlockPath.topIndex]?.content?.find((node: any) => node.type === 'detailsContent');
			if (!detailsContent?.content) { handleDragEnd(); return; }

			const rect = targetBlock.getBoundingClientRect();
			const insertBefore = e.clientY - rect.top < rect.height / 2;
			const [draggedBlock] = detailsContent.content.splice(draggedBlockPath.detailsChildIndex, 1);
			let insertIndex = targetPath.detailsChildIndex;
			if (draggedBlockPath.detailsChildIndex < targetPath.detailsChildIndex) insertIndex -= 1;
			if (!insertBefore) insertIndex += 1;
			detailsContent.content.splice(insertIndex, 0, draggedBlock);
			editor.commands.setContent(docJson, { emitUpdate: true });
			handleDragEnd();
			return;
		}

		// Drop from anywhere into a details content block (toggle heading children)
		if (targetPath.detailsChildIndex !== undefined) {
			const docJson: any = editor.getJSON();
			if (!docJson.content) { handleDragEnd(); return; }

			// Extract the dragged block from its source path
			const draggedBlock = extractBlockByPath(docJson.content, draggedBlockPath);
			if (!draggedBlock) { handleDragEnd(); return; }

			// Recalculate target's topIndex since extraction might have shifted the top-level array indices
			let actualTargetTopIndex = targetPath.topIndex;
			if (draggedBlockPath.detailsChildIndex === undefined && draggedBlockPath.columnIndex === undefined) {
				if (draggedBlockPath.topIndex < targetPath.topIndex) {
					actualTargetTopIndex -= 1;
				}
			}

			const details = docJson.content[actualTargetTopIndex];
			const detailsContent = details?.content?.find((node: any) => node.type === 'detailsContent');
			if (!detailsContent?.content) { handleDragEnd(); return; }

			const rect = targetBlock.getBoundingClientRect();
			const insertBefore = e.clientY - rect.top < rect.height / 2;

			let insertIndex = targetPath.detailsChildIndex;
			if (!insertBefore) {
				insertIndex += 1;
			}

			detailsContent.content.splice(insertIndex, 0, draggedBlock);
			editor.commands.setContent(docJson, { emitUpdate: true });
			handleDragEnd();
			return;
		}

		// Don't drop on itself (for top-level blocks)
		if (draggedBlockPath.columnIndex === undefined && draggedBlockPath.detailsChildIndex === undefined && targetIndex === draggedBlockPath.topIndex) {
			handleDragEnd();
			return;
		}

		const docJson: any = editor.getJSON();
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
			let actualTargetIndex = targetIndex;
			if (draggedBlockPath.columnIndex === undefined && draggedBlockPath.detailsChildIndex === undefined) {
				if (draggedBlockPath.topIndex < targetIndex) {
					actualTargetIndex = targetIndex - 1;
				}
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

			editor.commands.setContent(docJson, { emitUpdate: true });
		} else {
			// === VERTICAL DROP: Standard above/below reorder ===
			const rect = targetBlock.getBoundingClientRect();
			const relativeY = e.clientY - rect.top;
			const isInsertBefore = relativeY < rect.height / 2;

			// Calculate insert index (content may have shifted after extraction)
			let insertIndex = Math.min(targetIndex, docJson.content.length);
			if (draggedBlockPath.columnIndex === undefined && draggedBlockPath.detailsChildIndex === undefined) {
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

			editor.commands.setContent(docJson, { emitUpdate: true });
		}

		handleDragEnd();
	}
</script>

<article class="editor-page">
	<!-- Autosave Status Floating Indicator -->
	<div class="autosave-indicator" class:status-saving={autosaveStatus === 'saving'} class:status-error={autosaveStatus === 'error'}>
		{#if isLocked}
			<Lock size={14} />
			<span>Locked</span>
		{:else if autosaveStatus === 'saved'}
			<Cloud size={14} />
			<span>Saved</span>
		{:else if autosaveStatus === 'error'}
			<CloudLightning size={14} />
			<span>Save failed</span>
		{:else}
			<CloudLightning size={14} />
			<span>Saving...</span>
		{/if}
	</div>

	<!-- Page Icon emoji picker input -->
	<div class="page-icon-wrapper">
		<!-- Clickable Icon button -->
		<button 
			type="button" 
			class="icon-btn-picker" 
			disabled={isLocked}
			onclick={() => isIconPickerOpen = !isIconPickerOpen}
			title="Change page icon"
		>
			<PageIcon icon={icon} size={78} className="main-page-icon" />
		</button>

		<form 
			bind:this={iconForm}
			method="POST" 
			action="?/changeIcon" 
			use:enhance
			class="icon-form"
		>
			<input type="hidden" name="icon" value={icon} />
		</form>

		{#if isIconPickerOpen}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="icon-picker-overlay" onclick={() => isIconPickerOpen = false}></div>
			<div class="icon-picker-popover">
				<div class="icon-picker-search">
					<input 
						type="text" 
						placeholder="Paste custom emoji..." 
						bind:value={iconInputText}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								selectIcon(iconInputText);
							}
						}}
					/>
					<button type="button" class="apply-emoji-btn" onclick={() => selectIcon(iconInputText)}>Apply</button>
				</div>
				<div class="icon-picker-grid">
					{#each CURATED_ICONS as curated}
						<button 
							type="button" 
							class="icon-picker-item" 
							class:active={icon === 'lucide:' + curated.name}
							onclick={() => selectIcon('lucide:' + curated.name)}
							title={curated.label}
						>
							<curated.component size={18} strokeWidth={1.5} />
						</button>
					{/each}
				</div>
				<div class="icon-picker-footer">
					<button type="button" class="reset-icon-btn" onclick={() => selectIcon('📄')}>Reset to default</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Page Title editor input -->
	<div class="title-row">
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
				onkeydown={handleTitleKeyDown}
				class="page-title-input"
				placeholder="Untitled"
				spellcheck="false"
				disabled={isLocked}
			/>
		</form>
	</div>
	
	<!-- Subpages nested within this page -->
	{#if subPages.length > 0}
		<div class="subpages-list">
			{#each subPages as subPage}
				<a href="/{subPage.id}" class="subpages-item">
					<span class="subpages-icon-wrapper">
						<PageIcon icon={subPage.icon || '📄'} size={20} />
					</span>
					<span class="subpages-item-text">{subPage.title || 'Untitled'}</span>
				</a>
			{/each}
		</div>
	{/if}

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
						const rect = e.currentTarget.getBoundingClientRect();
						const spaceBelow = window.innerHeight - rect.bottom;
						// The block action menu height is about 380px now
						openUpward = spaceBelow < 380;
						isActionMenuOpen = !isActionMenuOpen;
					}}
					ondragstart={handleDragStart}
					ondragend={handleDragEnd}
					onkeydown={(e) => e.key === ' ' && (isActionMenuOpen = !isActionMenuOpen)}
				>
					<GripVertical size={19} />
				</div>

				<!-- Floating Block Action Options Dropdown -->
				{#if isActionMenuOpen}
					<div class="block-action-menu" class:open-upward={openUpward}>
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
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('toggleHeading', 1)}>
							<ChevronRight size={13} class="menu-icon" />
							<span>Toggle Heading 1</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('toggleHeading', 2)}>
							<ChevronRight size={13} class="menu-icon" />
							<span>Toggle Heading 2</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('toggleHeading', 3)}>
							<ChevronRight size={13} class="menu-icon" />
							<span>Toggle Heading 3</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('blockquote')}>
							<Quote size={13} class="menu-icon" />
							<span>Quote Block</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('codeBlock')}>
							<Code size={13} class="menu-icon" />
							<span>Code Block</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('todoList')}>
							<CheckSquare size={13} class="menu-icon" />
							<span>To-do List</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('divider')}>
							<Minus size={13} class="menu-icon" />
							<span>Divider</span>
						</button>
						<button class="menu-item-action" onclick={() => convertActiveBlockTo('table')}>
							<TableIcon size={13} class="menu-icon" />
							<span>Table</span>
						</button>
					</div>
				{/if}
			</div>
		{/if}

		<div bind:this={editorElement} class="tiptap-editor-element"></div>

		<!-- Table controls (Notion-style column/row adders) -->
		{#if isTableHovered && activeTableNode}
			<!-- Column Adder (vertical bar on the right) -->
			<div 
				class="table-column-adder"
				style="top: {tableHoverPosition.top}px; left: {tableHoverPosition.left + tableHoverPosition.width}px; height: {tableHoverPosition.height}px;"
			>
				<button 
					type="button" 
					class="table-adder-btn"
					title="Click to add a new column"
					onclick={() => {
						editor?.chain().focus().addColumnAfter().run();
						setTimeout(updateTablePositions, 20);
					}}
				>
					<Plus size={12} />
				</button>
			</div>

			<!-- Row Adder (horizontal bar at the bottom) -->
			<div 
				class="table-row-adder"
				style="top: {tableHoverPosition.top + tableHoverPosition.height}px; left: {tableHoverPosition.left}px; width: {tableHoverPosition.width}px;"
			>
				<button 
					type="button" 
					class="table-adder-btn"
					title="Click to add a new row"
					onclick={() => {
						editor?.chain().focus().addRowAfter().run();
						setTimeout(updateTablePositions, 20);
					}}
				>
					<Plus size={12} />
				</button>
			</div>
			<!-- Column Handle (above cell) -->
			<button 
				type="button"
				class="table-col-handle"
				style="top: {columnHandlePosition.top}px; left: {columnHandlePosition.left}px;"
				onclick={handleColumnHandleClick}
				title="Column options"
			></button>

			<!-- Row Handle (left of cell) -->
			<button 
				type="button"
				class="table-row-handle"
				style="top: {rowHandlePosition.top}px; left: {rowHandlePosition.left}px;"
				onclick={handleRowHandleClick}
				title="Row options"
			></button>
		{/if}

		<!-- Column Options Dropdown -->
		{#if isColMenuOpen}
			<div 
				class="table-handle-menu"
				style="top: {colMenuPosition.top}px; left: {colMenuPosition.left}px;"
			>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						editor?.chain().focus().deleteColumn().run();
						isColMenuOpen = false;
						isTableHovered = false;
					}}
				>
					<Trash2 size={13} class="menu-icon" />
					<span>Delete column</span>
				</button>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						editor?.chain().focus().addColumnBefore().run();
						isColMenuOpen = false;
						setTimeout(updateTablePositions, 20);
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert left</span>
				</button>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						editor?.chain().focus().addColumnAfter().run();
						isColMenuOpen = false;
						setTimeout(updateTablePositions, 20);
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert right</span>
				</button>
			</div>
		{/if}

		<!-- Row Options Dropdown -->
		{#if isRowMenuOpen}
			<div 
				class="table-handle-menu"
				style="top: {rowMenuPosition.top}px; left: {rowMenuPosition.left}px;"
			>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						editor?.chain().focus().deleteRow().run();
						isRowMenuOpen = false;
						isTableHovered = false;
					}}
				>
					<Trash2 size={13} class="menu-icon" />
					<span>Delete row</span>
				</button>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						editor?.chain().focus().addRowBefore().run();
						isRowMenuOpen = false;
						setTimeout(updateTablePositions, 20);
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert above</span>
				</button>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						editor?.chain().focus().addRowAfter().run();
						isRowMenuOpen = false;
						setTimeout(updateTablePositions, 20);
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert below</span>
				</button>
			</div>
		{/if}

		<!-- Svelte Bubble Menu (Managed by Tiptap BubbleMenu extension) -->
		<div bind:this={bubbleMenuElement} class="editor-bubble-menu">
			{#if editor}
				<button 
					type="button"
					class="bubble-btn" 
					class:active={editor!.isActive('bold')} 
					onclick={() => editor!.chain().focus().toggleBold().run()}
					title="Bold"
				>
					<Bold size={14} />
				</button>
				<button 
					type="button"
					class="bubble-btn" 
					class:active={editor!.isActive('italic')} 
					onclick={() => editor!.chain().focus().toggleItalic().run()}
					title="Italic"
				>
					<Italic size={14} />
				</button>
				<button 
					type="button"
					class="bubble-btn" 
					class:active={editor!.isActive('strike')} 
					onclick={() => editor!.chain().focus().toggleStrike().run()}
					title="Strikethrough"
				>
					<span style="text-decoration: line-through; font-weight: bold; font-size: 11px; line-height: 1;">S</span>
				</button>
				<button 
					type="button"
					class="bubble-btn" 
					class:active={editor!.isActive('code')} 
					onclick={() => editor!.chain().focus().toggleCode().run()}
					title="Inline Code"
				>
					<Code size={14} />
				</button>
				<button 
					type="button"
					class="bubble-btn" 
					class:active={editor.isActive('link')} 
					onclick={setLink}
					title="Link"
				>
					<LinkIcon size={14} />
				</button>

				<div class="bubble-divider"></div>

				<!-- Color & Highlight Picker -->
				<div style="position: relative; display: inline-block;">
					<button 
						type="button"
						class="bubble-btn bubble-color-btn" 
						onclick={() => isColorMenuOpen = !isColorMenuOpen}
						title="Text Color & Highlights"
					>
						<Palette size={14} />
					</button>

					{#if isColorMenuOpen}
						<div class="color-picker-dropdown">
							<div class="color-dropdown-section">Text Color</div>
							{#each colors as color}
								<button 
									type="button"
									class="color-dropdown-item" 
									onclick={() => {
										if (color.value === 'var(--text-main)') {
											editor!.chain().focus().unsetColor().run();
										} else {
											editor!.chain().focus().setColor(color.value).run();
										}
										isColorMenuOpen = false;
									}}
								>
									<span class="color-swatch" style="color: {color.value};">A</span>
									<span>{color.name}</span>
								</button>
							{/each}

							<div class="color-dropdown-section">Highlight</div>
							{#each highlights as hl}
								<button 
									type="button"
									class="color-dropdown-item" 
									onclick={() => {
										if (hl.value === 'transparent') {
											editor!.chain().focus().unsetHighlight().run();
										} else {
											editor!.chain().focus().setHighlight({ color: hl.value }).run();
										}
										isColorMenuOpen = false;
									}}
								>
									<span class="color-swatch-highlight" style="background-color: {hl.value === 'transparent' ? 'transparent' : hl.value}; border: {hl.value === 'transparent' ? '1px dashed var(--text-muted)' : 'none'};">A</span>
									<span>{hl.name}</span>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Floating Slash Command suggestions menu -->
		{#if isSlashMenuOpen && filteredItems.length > 0}
			<div 
				class="slash-command-menu" 
				style="top: {slashMenuPosition.top}px; left: {slashMenuPosition.left}px;"
			>
				{#each filteredItems as item, index}
					<button 
						type="button"
						class="slash-menu-item" 
						class:selected={index === slashSelectedIndex}
						onclick={() => handleSlashItemClick(item)}
					>
						<div class="slash-icon-wrapper">
							<item.icon size={16} />
						</div>
						<div class="slash-text-wrapper">
							<div class="slash-title">{item.title}</div>
							<div class="slash-desc">{item.description}</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
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
		height: 24px;
		z-index: 100;
		user-select: none;
	}

	.gutter-btn {
		width: 20px;
		height: 24px;
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

	.block-action-menu.open-upward {
		top: auto;
		bottom: 24px;
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
		position: fixed;
		top: 10px;
		right: 16px;
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
		z-index: 1000;
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
		position: relative;
	}

	.icon-btn-picker {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 90px;
		height: 90px;
		border-radius: 8px;
		background: transparent;
		cursor: pointer;
		transition: background var(--transition-speed);
		padding: 0;
	}

	.icon-btn-picker:hover {
		background-color: var(--hover-icon);
	}

	:global(.main-page-icon) {
		font-size: 78px;
		color: var(--text-main);
	}

	.icon-picker-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 100;
	}

	.icon-picker-popover {
		position: absolute;
		top: 100%;
		left: 0;
		margin-top: 8px;
		width: 280px;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
		z-index: 110;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.icon-picker-search {
		display: flex;
		gap: 6px;
	}

	.icon-picker-search input {
		flex: 1;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 4px;
		padding: 4px 8px;
		font-size: 13px;
		color: var(--text-main);
	}

	.apply-emoji-btn {
		background-color: var(--accent-color);
		color: white;
		border-radius: 4px;
		padding: 4px 8px;
		font-size: 12px;
		font-weight: 500;
	}

	.icon-picker-grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 4px;
		max-height: 180px;
		overflow-y: auto;
		padding-right: 4px;
	}

	.icon-picker-item {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border-radius: 4px;
		color: var(--text-muted);
		transition: background var(--transition-speed), color var(--transition-speed);
	}

	.icon-picker-item:hover {
		background-color: var(--hover-icon);
		color: var(--text-main);
	}

	.icon-picker-item.active {
		background-color: var(--active-sidebar);
		color: var(--accent-color);
	}

	.icon-picker-footer {
		border-top: 1px solid var(--border-color);
		padding-top: 6px;
		display: flex;
		justify-content: flex-end;
	}

	.reset-icon-btn {
		font-size: 11px;
		color: var(--text-muted);
		transition: color var(--transition-speed);
	}

	.reset-icon-btn:hover {
		color: var(--text-main);
	}

	/* Subpages nested list styling */
	.subpages-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 12px;
		margin-bottom: 20px;
		padding: 4px 0;
	}

	.subpages-item {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 17px;
		color: var(--text-main);
		text-decoration: none;
		padding: 5px 8px;
		border-radius: 4px;
		width: max-content;
		max-width: 100%;
		transition: background-color var(--transition-speed);
	}

	.subpages-item:hover {
		background-color: var(--hover-sidebar);
	}

	.subpages-item-text {
		font-weight: 550;
		border-bottom: 1px solid rgba(120, 120, 120, 0.15);
		line-height: 1.25;
		transition: border-color var(--transition-speed), color var(--transition-speed);
	}

	.subpages-item:hover .subpages-item-text {
		border-bottom-color: rgba(120, 120, 120, 0.6);
		color: var(--text-main);
	}

	.subpages-icon-wrapper {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--text-main);
		transition: transform var(--transition-speed);
	}

	.subpages-item:hover .subpages-icon-wrapper {
		transform: scale(1.05);
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 8px;
	}

	.title-form {
		flex: 1;
		min-width: 0;
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

	/* Bubble Menu styling */
	.editor-bubble-menu {
		display: flex;
		align-items: center;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		padding: 4px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		gap: 2px;
		z-index: 100;
		/* BubbleMenu moves this element only after there is a text selection. */
		visibility: hidden;
		opacity: 0;
		position: fixed;
		left: 0;
		top: 0;
	}

	.bubble-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: 4px;
		color: var(--text-muted);
		transition: background var(--transition-speed), color var(--transition-speed);
	}

	.bubble-btn:hover {
		background-color: var(--hover-sidebar);
		color: var(--text-main);
	}

	.bubble-btn.active {
		background-color: var(--active-sidebar);
		color: var(--accent-color);
	}

	.bubble-divider {
		width: 1px;
		height: 18px;
		background-color: var(--border-color);
		margin: 0 4px;
	}

	/* Color Picker Dropdown */
	.color-picker-dropdown {
		position: absolute;
		top: 100%;
		right: 0;
		margin-top: 6px;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
		z-index: 110;
		width: 180px;
		max-height: 280px;
		overflow-y: auto;
		padding: 6px 0;
	}

	.color-dropdown-section {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: var(--text-muted);
		padding: 6px 12px 2px;
		font-weight: 600;
	}

	.color-dropdown-item {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 5px 12px;
		font-size: 13px;
		color: var(--text-main);
		text-align: left;
		gap: 10px;
		transition: background var(--transition-speed);
	}

	.color-dropdown-item:hover {
		background-color: var(--hover-sidebar);
	}

	.color-swatch {
		font-weight: 700;
		font-size: 14px;
		width: 16px;
		text-align: center;
	}

	.color-swatch-highlight {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 3px;
		font-size: 11px;
		line-height: 16px;
		font-weight: 700;
		text-align: center;
		color: var(--text-main);
	}

	/* Slash Command Menu styling */
	.slash-command-menu {
		position: absolute;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
		z-index: 120;
		width: 280px;
		max-height: 320px;
		overflow-y: auto;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.slash-menu-item {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 6px 10px;
		border-radius: 6px;
		text-align: left;
		gap: 12px;
		transition: background var(--transition-speed);
	}

	.slash-menu-item:hover,
	.slash-menu-item.selected {
		background-color: var(--hover-sidebar);
	}

	.slash-icon-wrapper {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border-radius: 6px;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		color: var(--text-main);
	}

	.slash-text-wrapper {
		display: flex;
		flex-direction: column;
	}

	.slash-title {
		font-size: 13.5px;
		font-weight: 550;
		color: var(--text-main);
	}

	.slash-desc {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 1px;
	}

	/* Notion-style table adders */
	.table-column-adder, .table-row-adder {
		position: absolute;
		z-index: 90;
		pointer-events: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background-color var(--transition-speed);
	}

	/* Vertical column adder track */
	.table-column-adder {
		width: 24px;
		margin-left: 2px;
	}

	.table-column-adder:hover {
		background-color: rgba(255, 255, 255, 0.02);
	}

	:root:not(.dark) .table-column-adder:hover {
		background-color: rgba(0, 0, 0, 0.02);
	}

	/* Horizontal row adder track */
	.table-row-adder {
		height: 24px;
		margin-top: 2px;
	}

	.table-row-adder:hover {
		background-color: rgba(255, 255, 255, 0.02);
	}

	:root:not(.dark) .table-row-adder:hover {
		background-color: rgba(0, 0, 0, 0.02);
	}

	.table-adder-btn {
		width: 18px;
		height: 18px;
		background-color: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0.3;
		transition: opacity var(--transition-speed), color var(--transition-speed), transform var(--transition-speed);
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.table-column-adder:hover .table-adder-btn,
	.table-row-adder:hover .table-adder-btn,
	.table-adder-btn:hover {
		opacity: 1;
		color: var(--text-main);
		transform: scale(1.05);
	}

	/* Row and Column selection handles */
	.table-col-handle, .table-row-handle {
		position: absolute;
		background-color: var(--border-color);
		border-radius: 4px;
		cursor: pointer;
		z-index: 100;
		opacity: 0.5;
		transition: opacity var(--transition-speed), background-color var(--transition-speed), transform var(--transition-speed);
		border: 1px solid var(--border-color);
		box-shadow: 0 1px 3px rgba(0,0,0,0.1);
	}

	.table-col-handle {
		width: 24px;
		height: 8px;
	}

	.table-row-handle {
		width: 8px;
		height: 24px;
	}

	.table-col-handle:hover, .table-row-handle:hover {
		opacity: 1;
		background-color: var(--accent-color);
		border-color: var(--accent-color);
		transform: scale(1.1);
	}

	.table-handle-menu {
		position: absolute;
		background-color: var(--bg-canvas);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
		padding: 4px;
		width: 140px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		z-index: 210;
	}
</style>
