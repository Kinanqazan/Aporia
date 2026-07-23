<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { Editor, Extension, ResizableNodeView, mergeAttributes } from '@tiptap/core';
	import type { ResizableNodeViewDirection } from '@tiptap/core';
	import { Selection, Plugin, TextSelection } from '@tiptap/pm/state';
	import { DOMSerializer } from '@tiptap/pm/model';
	import { Decoration, DecorationSet } from '@tiptap/pm/view';
	import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
	import StarterKit from '@tiptap/starter-kit';
	import { ColumnLayout } from '$lib/editor/extensions/ColumnLayout';
	import { Column } from '$lib/editor/extensions/Column';
	import { Commands } from '$lib/editor/extensions/Commands';
	import { DatabaseBlock } from '$lib/editor/extensions/DatabaseBlockExtension.svelte';
	import { TextStyle } from '@tiptap/extension-text-style';
	import { Color } from '@tiptap/extension-color';
	import { Highlight } from '@tiptap/extension-highlight';
	import TiptapImage from '@tiptap/extension-image';
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
		CheckSquare, Minus, Table as TableIcon, ChevronRight, Lock,
		ChevronDown, Database, Image as ImageIcon, X, ZoomIn, ZoomOut, RotateCcw
	} from 'lucide-svelte';

	import { CURATED_ICONS } from '$lib/icons';
	import { ICON_COLORS } from '$lib/icon-colors';
	import PageIcon from '$lib/components/PageIcon.svelte';
	import { constrainImageSizeToWidth } from '$lib/editor/image-resize';

	let { data } = $props();
	
	let subPages = $derived(
		(data.activePages || [])
			.filter((p: any) => p.parentId === data.pageRecord.id)
			.sort((a: any, b: any) => a.position - b.position)
	);
	
	// Local state bound to input elements for title and icon
	function initialPageTitle() {
		return data.pageRecord.title;
	}

	function initialPageLockState() {
		return data.pageRecord.isLocked === 1;
	}

	function initialPageIcon() {
		return data.pageRecord.icon || '📄';
	}

	function initialPageIconColor() {
		return data.pageRecord.iconColor || null;
	}

	let title = $state(initialPageTitle());
	let isLocked = $state(initialPageLockState());
	let icon = $state(initialPageIcon());
	let iconColor = $state<string | null>(initialPageIconColor());
	
	let isIconPickerOpen = $state(false);
	let iconInputText = $state('');

	function selectIcon(newIcon: string) {
		if (isLocked) return;
		icon = newIcon.trim();
		if (icon === '📄') iconColor = null;
		isIconPickerOpen = false;
		submitIconChange();
	}

	function selectIconColor(newColor: string | null) {
		if (isLocked) return;
		iconColor = newColor;
		submitIconChange();
	}

	function submitIconChange() {
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
	let toggleCount = $state(0);
	let openToggleCount = $state(0);

	// Bubble Menu elements and states
	let bubbleMenuElement = $state<HTMLDivElement>();
	let isColorMenuOpen = $state(false);

	// Table interaction states
	let isTableHovered = $state(false);
	let activeTableNode = $state<HTMLTableElement | null>(null);

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
		if (isLocked || !editor || !activeCellNode) return;
		
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
		if (isLocked || !editor || !activeCellNode) return;
		
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

	let imageFileInput = $state<HTMLInputElement>();
	let isImagePickerOpen = $state(false);
	let isImageUploading = $state(false);
	let imageUrl = $state('');
	let imageError = $state('');
	let imageInsertRange = $state<{ from: number; to: number } | null>(null);

	// Image viewer state. The editor keeps the image's original size; zooming and
	// panning only affect this temporary preview layer.
	type ImageViewerImage = { src: string; alt: string; title: string };
	let imageViewer = $state<ImageViewerImage | null>(null);
	let imageViewerZoom = $state(1);
	let imageViewerPan = $state({ x: 0, y: 0 });
	let isImageViewerPanning = $state(false);
	let imageViewerGestureMoved = false;
	let imageViewerDragStart = { x: 0, y: 0 };
	let imageViewerPanStart = { x: 0, y: 0 };
	const IMAGE_VIEWER_MIN_ZOOM = 0.5;
	const IMAGE_VIEWER_MAX_ZOOM = 4;

	function openImageViewer(image: HTMLImageElement) {
		const src = image.currentSrc || image.src;
		if (!src) return;

		imageViewer = {
			src,
			alt: image.alt || 'Image preview',
			title: image.title || image.alt || ''
		};
		imageViewerZoom = 1;
		imageViewerPan = { x: 0, y: 0 };
		document.body.classList.add('image-viewer-open');
	}

	function closeImageViewer() {
		imageViewer = null;
		isImageViewerPanning = false;
		document.body.classList.remove('image-viewer-open');
	}

	function setImageViewerZoom(nextZoom: number) {
		imageViewerZoom = Math.min(IMAGE_VIEWER_MAX_ZOOM, Math.max(IMAGE_VIEWER_MIN_ZOOM, nextZoom));
		if (imageViewerZoom <= 1) imageViewerPan = { x: 0, y: 0 };
	}

	function zoomImageViewerIn() {
		setImageViewerZoom(imageViewerZoom + 0.5);
	}

	function zoomImageViewerOut() {
		setImageViewerZoom(imageViewerZoom - 0.5);
	}

	function resetImageViewer() {
		imageViewerZoom = 1;
		imageViewerPan = { x: 0, y: 0 };
	}

	function handleImageViewerKeydown(event: KeyboardEvent) {
		if (!imageViewer) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeImageViewer();
		} else if (event.key === '+' || event.key === '=') {
			event.preventDefault();
			zoomImageViewerIn();
		} else if (event.key === '-') {
			event.preventDefault();
			zoomImageViewerOut();
		} else if (event.key === '0') {
			event.preventDefault();
			resetImageViewer();
		}
	}

	function handleImageViewerPointerDown(event: PointerEvent) {
		if (imageViewerZoom <= 1) return;
		const target = event.target as HTMLElement;
		if (!target.closest('.image-viewer-image')) return;

		isImageViewerPanning = true;
		imageViewerGestureMoved = false;
		imageViewerDragStart = { x: event.clientX, y: event.clientY };
		imageViewerPanStart = { ...imageViewerPan };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		event.preventDefault();
	}

	function handleImageViewerPointerMove(event: PointerEvent) {
		if (!isImageViewerPanning) return;
		if (Math.abs(event.clientX - imageViewerDragStart.x) > 4 || Math.abs(event.clientY - imageViewerDragStart.y) > 4) {
			imageViewerGestureMoved = true;
		}
		imageViewerPan = {
			x: imageViewerPanStart.x + event.clientX - imageViewerDragStart.x,
			y: imageViewerPanStart.y + event.clientY - imageViewerDragStart.y
		};
	}

	function handleImageViewerPointerUp(event: PointerEvent) {
		isImageViewerPanning = false;
		const target = event.currentTarget as HTMLElement;
		if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
	}

	function handleImageViewerStageClick(event: MouseEvent) {
		// A drag can synthesize a click after pointer capture is released. Never
		// treat that gesture, or any click on the image itself, as a close action.
		if (imageViewerGestureMoved) {
			imageViewerGestureMoved = false;
			return;
		}
		if (event.target instanceof Element && event.target.closest('.image-viewer-image')) return;
		if (event.target === event.currentTarget) closeImageViewer();
	}

	function handleImageViewerWheel(event: WheelEvent) {
		event.preventDefault();
		setImageViewerZoom(imageViewerZoom + (event.deltaY > 0 ? -0.15 : 0.15));
	}

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

	const ArabicTextDirection = Extension.create({
		name: 'arabicTextDirection',
		addProseMirrorPlugins() {
			return [
				new Plugin({
					props: {
						decorations: (state) => {
							const decorations: Decoration[] = [];

							state.doc.descendants((node, position) => {
								if (node.isTextblock && containsArabic(node.textContent)) {
									decorations.push(
										Decoration.node(position, position + node.nodeSize, {
											dir: 'rtl',
											class: 'arabic-text-block'
										})
									);
								}

								if (node.type.name === 'blockquote' && containsArabic(node.textContent)) {
									decorations.push(
										Decoration.node(position, position + node.nodeSize, {
											class: 'arabic-quote'
										})
									);
								}
							});

							return DecorationSet.create(state.doc, decorations);
						}
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

	function updateToggleCount(document: ProseMirrorNode) {
		let count = 0;
		let openCount = 0;
		document.descendants((node) => {
			if (node.type.name === 'details') {
				count += 1;
				if (node.attrs.open) openCount += 1;
			}
		});
		toggleCount = count;
		openToggleCount = openCount;
	}

	function setAllToggles(open: boolean) {
		if (!editor || isLocked) return;

		let transaction = editor.state.tr;
		let changed = false;
		editor.state.doc.descendants((node, position) => {
			if (node.type.name !== 'details' || node.attrs.open === open) return;
			transaction = transaction.setNodeMarkup(position, undefined, { ...node.attrs, open });
			changed = true;
		});

		if (changed) editor.view.dispatch(transaction);
	}

	function openImagePicker(range?: { from: number; to: number }) {
		if (isLocked) return;
		imageInsertRange = range ?? null;
		imageUrl = '';
		imageError = '';
		isImagePickerOpen = true;
	}

	function closeImagePicker() {
		if (isImageUploading) return;
		isImagePickerOpen = false;
		imageInsertRange = null;
		imageError = '';
	}

	function insertImage(image: Record<string, unknown>, position?: number) {
		if (!editor) return;
		const chain = editor.chain().focus();
		if (imageInsertRange) {
			chain.deleteRange(imageInsertRange).insertContent({ type: 'image', attrs: image }).run();
		} else if (position !== undefined) {
			chain.insertContentAt(position, { type: 'image', attrs: image }).run();
		} else {
			chain.insertContent({ type: 'image', attrs: image }).run();
		}
		imageInsertRange = null;
	}

	async function uploadImage(file: File, position?: number) {
		if (isLocked || !editor) return;
		isImageUploading = true;
		imageError = '';
		try {
			const formData = new FormData();
			formData.set('pageId', data.pageRecord.id);
			formData.set('file', file);
			const response = await fetch('/api/assets', { method: 'POST', body: formData });
			const result = await response.json();
			if (!response.ok || !result.success) throw new Error(result.error || 'Unable to upload image');
			insertImage(result.image, position);
			isImagePickerOpen = false;
		} catch (error) {
			imageError = error instanceof Error ? error.message : 'Unable to upload image';
		} finally {
			isImageUploading = false;
		}
	}

	function selectLocalImage() {
		imageError = '';
		imageFileInput?.click();
	}

	function handleImageFileInput(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) void uploadImage(file);
	}

	function insertRemoteImage() {
		const value = imageUrl.trim();
		try {
			const parsed = new URL(value);
			if (parsed.protocol !== 'https:') throw new Error('Image links must use HTTPS');
			insertImage({ src: parsed.href, source: 'remote', assetId: null, alt: '', title: '' });
			isImagePickerOpen = false;
			imageUrl = '';
			imageError = '';
		} catch (error) {
			imageError = error instanceof Error ? error.message : 'Enter a valid HTTPS image URL';
		}
	}

	function imageFileFrom(files: FileList | null | undefined): File | null {
		if (!files) return null;
		return Array.from(files).find((file) => file.type.startsWith('image/')) ?? null;
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
			title: 'Image',
			description: 'Upload an image or embed it from a link.',
			searchTerms: ['image', 'photo', 'picture', 'upload', 'embed', 'media'],
			icon: ImageIcon,
			action: (_editor: Editor, range: any) => openImagePicker(range)
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
		},
		{
			title: 'Database Table',
			description: 'Insert a data table with sorting, filtering, and typed columns.',
			searchTerms: ['database', 'table', 'grid', 'datatable', 'sort', 'filter'],
			icon: Database,
			action: (editor: Editor, range: any) => {
				editor
					.chain()
					.focus()
					.deleteRange(range)
					.insertContent({
						type: 'databaseBlock',
						attrs: {
							columns: [
								{ id: 'name', name: 'Name', type: 'text' },
								{ id: 'status', name: 'Status', type: 'status' },
								{ id: 'date', name: 'Date', type: 'date' }
							],
							rows: [
								{ id: 'row-1', name: 'Draft implementation plan', status: 'Done', date: '2026-07-19' },
								{ id: 'row-2', name: 'Build Svelte 5 component', status: 'In Progress', date: '2026-07-20' },
								{ id: 'row-3', name: 'Verify Markdown export', status: 'Todo', date: '2026-07-21' }
							],
							options: {
								status: ['Todo', 'In Progress', 'Done']
							}
						}
					})
					.run();
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

	/** JSON path to a block. Each entry is an index into the current node's content. */
	type BlockPath = { nodePath: number[] };
	let draggedBlockPath = $state<BlockPath | null>(null);

	let isMobile = $state(false);

	function containsArabic(text: string) {
		return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(text);
	}

	function handleResize() {
		isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : false;
	}

	// Reset inputs when navigating between pages
	$effect(() => {
		title = data.pageRecord.title;
		iconColor = data.pageRecord.iconColor || null;
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
					link: false,
					heading: {
						levels: [1, 2, 3]
					}
				}),
				ImageBlock.configure({
					inline: false,
					allowBase64: false,
					resize: {
						enabled: true,
						directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
						minWidth: 100,
						minHeight: 75,
						alwaysPreserveAspectRatio: true
					},
					HTMLAttributes: {
						class: 'editor-image',
						referrerpolicy: 'no-referrer'
					}
				}),
				ToggleHeading.configure({
					persist: true
				}),
				PreserveDetailsLevel,
				ArabicTextDirection,
				DetailsSummary,
				DetailsContent,
				ColumnLayout,
				Column,
				DatabaseBlock,
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
					nested: true,
					onReadOnlyChecked: (node: ProseMirrorNode, checked: boolean) => {
						if (!editor) return false;

						let position: number | null = null;
						let equivalentPosition: number | null = null;
						let equivalentMatches = 0;
						editor.state.doc.descendants((candidate, candidatePosition) => {
							if (candidate === node) {
								position = candidatePosition;
								return false;
							}
							if (candidate.type === node.type && candidate.eq(node)) {
								equivalentPosition = candidatePosition;
								equivalentMatches += 1;
							}
							return true;
						});

						if (position === null && equivalentMatches === 1) position = equivalentPosition;
						if (position === null) return false;

						const currentNode = editor.state.doc.nodeAt(position);
						if (!currentNode || currentNode.type.name !== 'taskItem') return false;

						editor.view.dispatch(editor.state.tr.setNodeMarkup(position, undefined, {
							...currentNode.attrs,
							checked
						}));
						triggerAutosave(JSON.stringify(editor.getJSON()), { allowWhenLocked: true });
						void flushPendingSave();

						return true;
					}
				}),
				TiptapTable.configure({
					resizable: true,
					// Keep the resize affordance easy to grab without allowing columns
					// to collapse into unusable slivers.
					handleWidth: 8,
					cellMinWidth: 72
				}),
				TableRow,
				TableHeader,
				TableCell,
				BubbleMenu.configure({
					element: bubbleMenuElement,
					shouldShow: ({ state }) => !isLocked && state.selection instanceof TextSelection && !state.selection.empty,
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
					handlePaste: (view, event) => {
						if (isLocked) return false;
						const file = imageFileFrom(event.clipboardData?.files);
						if (!file) return false;
						event.preventDefault();
						void uploadImage(file, view.state.selection.from);
						return true;
					},
					handleDrop: (view, event, _slice, moved) => {
						if (isLocked || moved) return false;
						const file = imageFileFrom(event.dataTransfer?.files);
						if (!file) return false;
						event.preventDefault();
						const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
						void uploadImage(file, position);
						return true;
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
				updateToggleCount(editor.state.doc);
				triggerAutosave(jsonStr);
			}
		});
		updateToggleCount(editor.state.doc);

		// Override the clipboard serializer so copy/cut uses the schema's
		// toDOM (renderHTML) instead of the node views. The DetailsContent node
		// view starts with hidden="hidden", which causes the browser to skip
		// the nested content during clipboard serialization. By using a
		// schema-based serializer, all content (including collapsed toggle
		// bodies) is always included in the clipboard payload.
		editor.view.setProps({
			clipboardSerializer: DOMSerializer.fromSchema(editor.schema)
		});

		editorPageId = data.pageRecord.id;
	}

	$effect(() => {
		editor?.setEditable(!isLocked);
		if (isLocked) {
			isIconPickerOpen = false;
			isColorMenuOpen = false;
			isSlashMenuOpen = false;
			isGutterVisible = false;
			activeBlockNode = null;
			isTableHovered = false;
			activeTableNode = null;
			activeCellNode = null;
			isColMenuOpen = false;
			isRowMenuOpen = false;
		}
	});

	const ImageBlock = TiptapImage.extend({
		addAttributes() {
			return {
				...(this.parent?.() ?? {}),
				source: {
					default: 'remote',
					parseHTML: (element) => element.getAttribute('data-source') || 'remote',
					renderHTML: (attributes) => ({ 'data-source': attributes.source })
				},
				assetId: {
					default: null,
					parseHTML: (element) => element.getAttribute('data-asset-id'),
					renderHTML: (attributes) => attributes.assetId ? ({ 'data-asset-id': attributes.assetId }) : ({})
				}
			};
		},
		addNodeView() {
			if (!this.options.resize || !this.options.resize.enabled || typeof document === 'undefined') {
				return null;
			}

			const { directions, minWidth, minHeight, alwaysPreserveAspectRatio } = this.options.resize;

			return ({ node, getPos, HTMLAttributes, editor }) => {
				const element = document.createElement('img');
				element.draggable = false;

				const mergedAttributes = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
				Object.entries(mergedAttributes).forEach(([key, value]) => {
					if (value == null || key === 'width' || key === 'height') return;
					element.setAttribute(key, String(value));
				});

				if (mergedAttributes.src != null) element.src = String(mergedAttributes.src);

				const getContainingBlockWidth = () => {
					const container = element.parentElement?.parentElement;
					const containingBlock = container?.parentElement;
					return containingBlock && containingBlock.clientWidth > 0 ? containingBlock.clientWidth : Infinity;
				};

				const constrainToContainingBlock = (width: number, height: number) =>
					constrainImageSizeToWidth({ width, height }, getContainingBlockWidth());

				const nodeView = new ResizableNodeView({
					element,
					editor,
					node,
					getPos,
					onResize: (width, height) => {
						const constrained = constrainToContainingBlock(width, height);
						element.style.width = `${constrained.width}px`;
						element.style.height = `${constrained.height}px`;
					},
					onCommit: (width, height) => {
						const constrained = constrainToContainingBlock(width, height);
						const pos = getPos();
						if (pos === undefined) return;

						this.editor
							.chain()
							.setNodeSelection(pos)
							.updateAttributes(this.name, constrained)
							.run();
					},
					onUpdate: (updatedNode) => updatedNode.type === node.type,
					options: {
						directions: directions as ResizableNodeViewDirection[] | undefined,
						min: {
							width: minWidth,
							height: minHeight
						},
						preserveAspectRatio: alwaysPreserveAspectRatio === true
					}
				});

				const dom = nodeView.dom as HTMLElement;
				dom.style.visibility = 'hidden';
				dom.style.pointerEvents = 'none';

				const applyInitialConstraint = () => {
					const width = typeof node.attrs.width === 'number' && node.attrs.width > 0 ? node.attrs.width : element.offsetWidth;
					const height = typeof node.attrs.height === 'number' && node.attrs.height > 0 ? node.attrs.height : element.offsetHeight;
					if (width <= 0 || height <= 0) return;

					const constrained = constrainToContainingBlock(width, height);
					if (constrained.width !== width || constrained.height !== height) {
						element.style.width = `${constrained.width}px`;
						element.style.height = `${constrained.height}px`;
					}
				};

				element.onload = () => {
					applyInitialConstraint();
					dom.style.visibility = '';
					dom.style.pointerEvents = '';
				};
				queueMicrotask(applyInitialConstraint);

				return nodeView;
			};
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
		editorElement?.addEventListener('dblclick', handleEditorImageClick);
		window.addEventListener('keydown', handleImageViewerKeydown);
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
			editorElement?.removeEventListener('dblclick', handleEditorImageClick);
			window.removeEventListener('keydown', handleImageViewerKeydown);
			window.removeEventListener('resize', handleResize);
			document.body.classList.remove('image-viewer-open');
		}
	});

	function handleMouseMove(e: MouseEvent) {
		if (!editorElement || !editor || isActionMenuOpen) return;
		if (isLocked) {
			isGutterVisible = false;
			activeBlockNode = null;
			return;
		}

		const editorRect = editorElement.getBoundingClientRect();
		const target = e.target as HTMLElement;

		// If we are already hovering a table, check if mouse is still near it
		if (activeTableNode && isTableHovered) {
			const rect = activeTableNode.getBoundingClientRect();
			// Keep the handles alive while the pointer crosses the small gap around
			// the table, to make the menu easy to reach.
			const isNearTable = 
				e.clientX >= rect.left - 30 &&
				e.clientX <= rect.right + 30 &&
				e.clientY >= rect.top - 30 &&
				e.clientY <= rect.bottom + 30;
			
			if (isNearTable) {
				isGutterVisible = false;
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
			'.ProseMirror > *, .ProseMirror [data-type="detailsContent"] > *, .ProseMirror [data-type="column"] > *'
		)).filter(node => {
			const el = node as HTMLElement;
			return !el.matches('[data-type="columnLayout"], [data-type="column"], [data-type="detailsContent"], [data-type="detailsSummary"]');
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

	function handleEditorImageClick(event: MouseEvent) {
		const target = event.target;
		if (!(target instanceof HTMLImageElement)) return;
		const image = target.closest<HTMLImageElement>('img.editor-image');
		if (!image) return;

		// Keep the image selectable in the editor while opening a full-size preview
		// from the same click, like Notion.
		openImageViewer(image);
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

	function triggerAutosave(contentJson: string, options: { allowWhenLocked?: boolean } = {}) {
		// Prevent normal editor transactions from queueing content updates while
		// locked. The task checkbox handler opts in explicitly above.
		if (isLocked && !options.allowWhenLocked) {
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

	function getBlockPathForElement(block: HTMLElement): BlockPath | null {
		if (!editor) return null;
		let position: number | null = null;
		editor.state.doc.descendants((node, pos) => {
			if (editor?.view.nodeDOM(pos) === block) {
				position = pos;
				return false;
			}
			return true;
		});
		if (position === null) return null;
		const resolved = editor.state.doc.resolve(position);
		const nodePath: number[] = [];
		for (let depth = 0; depth <= resolved.depth; depth += 1) {
			nodePath.push(resolved.index(depth));
		}
		return { nodePath };
	}

	function getActiveBlockPath(): BlockPath | null {
		return activeBlockNode ? getBlockPathForElement(activeBlockNode) : null;
	}

	function sameBlockPath(a: BlockPath, b: BlockPath): boolean {
		return a.nodePath.length === b.nodePath.length &&
			a.nodePath.every((index, i) => index === b.nodePath[i]);
	}

	function getJsonLocation(root: any[], path: BlockPath) {
		let container = root;
		for (let i = 0; i < path.nodePath.length - 1; i += 1) {
			container = container?.[path.nodePath[i]]?.content;
		}
		const index = path.nodePath[path.nodePath.length - 1];
		return Array.isArray(container) ? { container, index } : null;
	}

	function getContainingColumnLayoutPath(root: any[], path: BlockPath): BlockPath | null {
		if (path.nodePath.length < 3) return null;
		const layoutPath = { nodePath: path.nodePath.slice(0, -2) };
		const layout = getJsonLocation(root, layoutPath);
		return layout?.container[layout.index]?.type === 'columnLayout' ? layoutPath : null;
	}

	function getDragTargetBlock(e: DragEvent): HTMLElement | null {
		if (!editorElement) return null;
		const candidates = Array.from(editorElement.querySelectorAll(
			'.ProseMirror > *, .ProseMirror [data-type="detailsContent"] > *, .ProseMirror [data-type="column"] > *'
		)).filter((node): node is HTMLElement => {
			if (!(node instanceof HTMLElement)) return false;
			return !node.matches('[data-type="columnLayout"], [data-type="column"], [data-type="detailsContent"], [data-type="detailsSummary"]');
		});
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
		const location = getJsonLocation(docJson.content, path);
		const container = location?.container;
		const index = location?.index ?? -1;

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
		draggedBlockIndex = path.nodePath[0];
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
		const rect = targetBlock.getBoundingClientRect();
		const relativeX = e.clientX - rect.left;
		const relativeY = e.clientY - rect.top;

		// Check if cursor is near the left or right edge → horizontal column drop
		const isNearLeftEdge = relativeX < COLUMN_EDGE_THRESHOLD;
		const isNearRightEdge = relativeX > (rect.width - COLUMN_EDGE_THRESHOLD);

		if (isNearLeftEdge || isNearRightEdge) {
			// Check column count limit: if target is already a columnLayout, count existing columns
			const docJson = editor?.getJSON();
			const layoutPath = docJson?.content && getContainingColumnLayoutPath(docJson.content, targetPath);
			const layoutLocation = layoutPath && docJson?.content
				? getJsonLocation(docJson.content, layoutPath)
				: null;
			const targetLayout = layoutLocation?.container[layoutLocation.index];
			if (targetLayout?.type === 'columnLayout' && (targetLayout.content?.length || 0) >= MAX_COLUMNS) {
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

	/** Remove empty columns and unwrap layouts that no longer need a row. */
	function normalizeColumnLayouts(nodes: any[]): any[] {
		const normalized: any[] = [];
		for (const node of nodes) {
			if (node.content) node.content = normalizeColumnLayouts(node.content);
			if (node.type !== 'columnLayout') {
				normalized.push(node);
				continue;
			}
			node.content = (node.content || []).filter((column: any) => column.content?.length);
			if (node.content.length === 0) continue;
			if (node.content.length === 1) normalized.push(...(node.content[0].content || []));
			else normalized.push(node);
		}
		return normalized;
	}

	function extractBlockByPath(docContent: any[], path: BlockPath): any {
		const location = getJsonLocation(docContent, path);
		return location ? location.container.splice(location.index, 1)[0] : undefined;
	}

	function adjustPathAfterRemoval(path: BlockPath, removed: BlockPath): BlockPath {
		const removedParent = removed.nodePath.slice(0, -1);
		if (path.nodePath.length <= removedParent.length ||
			!removedParent.every((index, i) => index === path.nodePath[i])) return path;
		const nodePath = [...path.nodePath];
		const removedIndex = removed.nodePath.at(-1)!;
		const targetIndex = nodePath[removedParent.length];
		if (removedIndex < targetIndex) nodePath[removedParent.length] -= 1;
		return { nodePath };
	}

	function handleDrop(e: DragEvent) {
		if (draggedBlockPath === null || !editor || !editorElement) return;
		e.preventDefault();
		e.stopPropagation();

		const targetBlock = getDragTargetBlock(e);

		if (!targetBlock) { handleDragEnd(); return; }
		const targetPath = getBlockPathForElement(targetBlock);
		if (!targetPath || sameBlockPath(targetPath, draggedBlockPath)) { handleDragEnd(); return; }
		// A block cannot be dropped into one of its own descendants.
		if (targetPath.nodePath.length > draggedBlockPath.nodePath.length &&
			draggedBlockPath.nodePath.every((index, i) => index === targetPath.nodePath[i])) {
			handleDragEnd();
			return;
		}

		const docJson: any = editor.getJSON();
		if (!docJson.content) { handleDragEnd(); return; }

		// Extract first, then adjust the target path if both blocks shared a container.
		const draggedBlock = extractBlockByPath(docJson.content, draggedBlockPath);
		if (!draggedBlock) { handleDragEnd(); return; }
		const adjustedTargetPath = adjustPathAfterRemoval(targetPath, draggedBlockPath);

		if (dropMode === 'horizontal') {
			// === COLUMN DROP: Place blocks side-by-side ===
			const rect = targetBlock.getBoundingClientRect();
			const relativeX = e.clientX - rect.left;
			const isLeftSide = relativeX < COLUMN_EDGE_THRESHOLD;

			const targetLocation = getJsonLocation(docJson.content, adjustedTargetPath);
			if (!targetLocation) { handleDragEnd(); return; }
			const targetNode = targetLocation.container[targetLocation.index];
			const layoutPath = getContainingColumnLayoutPath(docJson.content, adjustedTargetPath);
			const layoutLocation = layoutPath ? getJsonLocation(docJson.content, layoutPath) : null;
			const containingLayout = layoutLocation?.container[layoutLocation.index];

			if (containingLayout) {
				if ((containingLayout.content?.length || 0) < MAX_COLUMNS) {
					const newCol = { type: 'column', content: [draggedBlock] };
					if (isLeftSide) {
						containingLayout.content!.unshift(newCol);
					} else {
						containingLayout.content!.push(newCol);
					}
				}
			} else {
				const colA = { type: 'column', content: [targetNode] };
				const colB = { type: 'column', content: [draggedBlock] };
				const layout = {
					type: 'columnLayout',
					content: isLeftSide ? [colB, colA] : [colA, colB]
				};
				targetLocation.container[targetLocation.index] = layout;
			}

			docJson.content = normalizeColumnLayouts(docJson.content);
			editor.commands.setContent(docJson, { emitUpdate: true });
		} else {
			// === VERTICAL DROP: Standard above/below reorder ===
			const rect = targetBlock.getBoundingClientRect();
			const relativeY = e.clientY - rect.top;
			const isInsertBefore = relativeY < rect.height / 2;

			const targetLocation = getJsonLocation(docJson.content, adjustedTargetPath);
			if (!targetLocation) { handleDragEnd(); return; }
			let insertIndex = targetLocation.index;
			if (!isInsertBefore) {
				insertIndex += 1;
			}

			targetLocation.container.splice(insertIndex, 0, draggedBlock);
			docJson.content = normalizeColumnLayouts(docJson.content);

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
			<PageIcon icon={icon} color={iconColor} size={78} className="main-page-icon" />
		</button>

		<form 
			bind:this={iconForm}
			method="POST" 
			action="?/changeIcon" 
			use:enhance
			class="icon-form"
		>
			<input type="hidden" name="icon" value={icon} />
			<input type="hidden" name="iconColor" value={iconColor || ''} />
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
							<curated.component size={18} color={iconColor || 'currentColor'} strokeWidth={1.5} />
						</button>
					{/each}
				</div>
				<div class="icon-color-section">
					<span class="icon-color-label">Icon color</span>
					<div class="icon-color-palette" role="group" aria-label="Icon color">
						{#each ICON_COLORS as color}
							<button
								type="button"
								class="icon-color-item"
								class:active={iconColor === color.value}
								aria-label={color.label}
								aria-pressed={iconColor === color.value}
								title={color.label}
								onclick={() => selectIconColor(color.value)}
							>
								<span class="icon-color-swatch" style:background={color.value || 'var(--text-main)'}></span>
							</button>
						{/each}
					</div>
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
				dir={containsArabic(title) ? 'rtl' : 'ltr'}
				class:arabic-text-input={containsArabic(title)}
				placeholder="Untitled"
				spellcheck="false"
				disabled={isLocked}
			/>
		</form>
		{#if !isLocked && toggleCount > 0}
			<div class="toggle-page-actions" aria-label="Toggle controls">
				<button
					type="button"
					class="toggle-page-action"
					onclick={() => setAllToggles(openToggleCount !== toggleCount)}
					title={openToggleCount === toggleCount ? 'Collapse all toggles' : 'Expand all toggles'}
				>
					{#if openToggleCount === toggleCount}
						<ChevronRight size={15} />
						<span>Collapse all</span>
					{:else}
						<ChevronDown size={15} />
						<span>Expand all</span>
					{/if}
				</button>
			</div>
		{/if}
	</div>
	
	<!-- Subpages nested within this page -->
	{#if subPages.length > 0}
		<div class="subpages-list">
			{#each subPages as subPage}
				<a href="/{subPage.id}" class="subpages-item">
							<span class="subpages-icon-wrapper">
								<PageIcon icon={subPage.icon || '📄'} color={subPage.iconColor} size={24} />
					</span>
					<span
						class="subpages-item-text"
						dir={containsArabic(subPage.title || '') ? 'rtl' : 'ltr'}
						class:arabic-text-input={containsArabic(subPage.title || '')}
					>{subPage.title || 'Untitled'}</span>
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
		{#if isGutterVisible && !isMobile && !isLocked}
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

		<!-- Table controls: column/row handles open the insert/delete menus. -->
		{#if !isLocked && isTableHovered && activeTableNode}
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
		{#if !isLocked && isColMenuOpen}
			<div 
				class="table-handle-menu"
				style="top: {colMenuPosition.top}px; left: {colMenuPosition.left}px;"
			>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						if (isLocked) return;
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
						if (isLocked) return;
						editor?.chain().focus().addColumnBefore().run();
						isColMenuOpen = false;
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert left</span>
				</button>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						if (isLocked) return;
						editor?.chain().focus().addColumnAfter().run();
						isColMenuOpen = false;
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert right</span>
				</button>
			</div>
		{/if}

		<!-- Row Options Dropdown -->
		{#if !isLocked && isRowMenuOpen}
			<div 
				class="table-handle-menu"
				style="top: {rowMenuPosition.top}px; left: {rowMenuPosition.left}px;"
			>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						if (isLocked) return;
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
						if (isLocked) return;
						editor?.chain().focus().addRowBefore().run();
						isRowMenuOpen = false;
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert above</span>
				</button>
				<button 
					type="button" 
					class="menu-item-action"
					onclick={() => {
						if (isLocked) return;
						editor?.chain().focus().addRowAfter().run();
						isRowMenuOpen = false;
					}}
				>
					<Plus size={13} class="menu-icon" />
					<span>Insert below</span>
				</button>
			</div>
		{/if}

		<!-- Svelte Bubble Menu (Managed by Tiptap BubbleMenu extension) -->
		<div bind:this={bubbleMenuElement} class="editor-bubble-menu" class:locked={isLocked}>
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
				{#if !isLocked}
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

	<input
		bind:this={imageFileInput}
		type="file"
		accept="image/png,image/jpeg,image/gif,image/webp"
		class="image-file-input"
		onchange={handleImageFileInput}
	/>

	{#if isImagePickerOpen}
		<div class="image-picker-backdrop" role="presentation" onclick={closeImagePicker}></div>
		<div class="image-picker" role="dialog" aria-modal="true" aria-label="Add image">
			<div class="image-picker-header">
				<div>
					<h2>Add an image</h2>
					<p>Upload a file or embed an HTTPS image link.</p>
				</div>
				<button type="button" class="image-picker-close" onclick={closeImagePicker} aria-label="Close image picker">×</button>
			</div>

			<button type="button" class="image-upload-button" disabled={isImageUploading} onclick={selectLocalImage}>
				<ImageIcon size={18} />
				<span>{isImageUploading ? 'Uploading image…' : 'Upload image'}</span>
			</button>

			<div class="image-picker-separator"><span>or</span></div>
			<label class="image-url-label" for="image-url">Embed link</label>
			<div class="image-url-row">
				<input id="image-url" bind:value={imageUrl} placeholder="https://example.com/image.png" onkeydown={(event) => event.key === 'Enter' && insertRemoteImage()} />
				<button type="button" disabled={!imageUrl.trim()} onclick={insertRemoteImage}>Embed</button>
			</div>
			{#if imageError}
				<p class="image-picker-error">{imageError}</p>
			{/if}
		</div>
	{/if}

	{#if imageViewer}
		<div class="image-viewer" role="dialog" aria-modal="true" aria-label="Image preview" tabindex="-1">
			<div class="image-viewer-toolbar">
				<div class="image-viewer-controls" aria-label="Image zoom controls">
					<button type="button" class="image-viewer-control" onclick={zoomImageViewerOut} disabled={imageViewerZoom <= IMAGE_VIEWER_MIN_ZOOM} aria-label="Zoom out" title="Zoom out">
						<ZoomOut size={17} />
					</button>
					<span class="image-viewer-zoom" aria-live="polite">{Math.round(imageViewerZoom * 100)}%</span>
					<button type="button" class="image-viewer-control" onclick={zoomImageViewerIn} disabled={imageViewerZoom >= IMAGE_VIEWER_MAX_ZOOM} aria-label="Zoom in" title="Zoom in">
						<ZoomIn size={17} />
					</button>
					<button type="button" class="image-viewer-control" onclick={resetImageViewer} aria-label="Reset zoom" title="Reset zoom">
						<RotateCcw size={16} />
					</button>
				</div>
				<button type="button" class="image-viewer-close" onclick={closeImageViewer} aria-label="Close image preview" title="Close">
					<X size={20} />
				</button>
			</div>

			<button
				type="button"
				class="image-viewer-stage"
				class:panning={isImageViewerPanning}
				onclick={handleImageViewerStageClick}
				onpointerdown={handleImageViewerPointerDown}
				onpointermove={handleImageViewerPointerMove}
				onpointerup={handleImageViewerPointerUp}
				onpointercancel={handleImageViewerPointerUp}
				onwheel={handleImageViewerWheel}
				aria-label="Close image preview"
			>
				<img
					class="image-viewer-image"
					src={imageViewer.src}
					alt={imageViewer.alt}
					draggable="false"
					style={`transform: translate(${imageViewerPan.x}px, ${imageViewerPan.y}px) scale(${imageViewerZoom});`}
				/>
			</button>

			{#if imageViewer.title}
				<p class="image-viewer-caption">{imageViewer.title}</p>
			{/if}
		</div>
	{/if}
</article>

<style>
	.editor-page {
		position: relative;
		padding-top: 24px;
	}

	@media (max-width: 768px) {
		.editor-page {
			padding-top: 8px;
		}
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
		top: calc(10px + env(safe-area-inset-top));
		right: max(16px, env(safe-area-inset-right));
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

	:global(.mobile) .autosave-indicator {
		top: calc(18px + env(safe-area-inset-top));
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

	.icon-color-section {
		border-top: 1px solid var(--border-color);
		padding-top: 8px;
	}

	.icon-color-label {
		display: block;
		margin-bottom: 6px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
	}

	.icon-color-palette {
		display: flex;
		align-items: center;
		gap: 7px;
		flex-wrap: wrap;
	}

	.icon-color-item {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		border: 1px solid transparent;
		border-radius: 50%;
		transition: transform var(--transition-speed), border-color var(--transition-speed);
	}

	.icon-color-item:hover,
	.icon-color-item.active {
		border-color: var(--text-main);
		transform: scale(1.1);
	}

	.icon-color-swatch {
		width: 13px;
		height: 13px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.14);
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
		gap: 10px;
		font-size: 18px;
		color: var(--text-main);
		text-decoration: none;
		padding: 7px 10px;
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

	.toggle-page-actions {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
	}

	.toggle-page-action {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 5px 7px;
		border-radius: 5px;
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.toggle-page-action:hover:not(:disabled) {
		background: var(--hover-sidebar);
		color: var(--text-main);
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

	.page-title-input.arabic-text-input,
	.subpages-item-text.arabic-text-input {
		direction: rtl;
		text-align: right;
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

	:global(.tiptap-content-canvas img.editor-image) {
		display: block;
		max-width: 100%;
		height: auto;
		border-radius: 6px;
		margin: 10px 0;
		cursor: pointer;
	}

	:global(.tiptap-content-canvas img.editor-image.ProseMirror-selectednode) {
		outline: 2px solid var(--accent-color);
		outline-offset: 2px;
	}

	:global([data-resize-container][data-node='image']) {
		margin: 10px 0;
		max-width: 100%;
	}

	:global([data-resize-container][data-node='image'] img.editor-image) {
		margin: 0;
	}

	:global([data-resize-container][data-node='image'] [data-resize-handle]) {
		width: 12px;
		height: 12px;
		margin: -6px;
		border: 2px solid var(--bg-canvas);
		border-radius: 50%;
		background: var(--accent-color);
		z-index: 2;
		opacity: 0;
		pointer-events: none;
		transition: opacity 120ms ease;
	}

	:global([data-resize-container][data-node='image'].ProseMirror-selectednode [data-resize-handle]),
	:global([data-resize-container][data-node='image'][data-resize-state='true'] [data-resize-handle]) {
		opacity: 1;
		pointer-events: auto;
	}

	:global([data-resize-handle='top-left']),
	:global([data-resize-handle='bottom-right']) {
		cursor: nwse-resize;
	}

	:global([data-resize-handle='top-right']),
	:global([data-resize-handle='bottom-left']) {
		cursor: nesw-resize;
	}

	:global(body.image-viewer-open) {
		overflow: hidden;
	}

	.image-viewer {
		position: fixed;
		inset: 0;
		z-index: 1000;
		display: flex;
		flex-direction: column;
		align-items: center;
		background: rgba(15, 15, 18, 0.9);
		backdrop-filter: blur(3px);
		color: white;
	}

	.image-viewer-toolbar {
		position: absolute;
		top: 16px;
		left: 20px;
		right: 20px;
		z-index: 2;
		display: flex;
		align-items: center;
		justify-content: space-between;
		pointer-events: none;
	}

	.image-viewer-controls,
	.image-viewer-close {
		pointer-events: auto;
		border: 1px solid rgba(255, 255, 255, 0.18);
		background: rgba(30, 30, 34, 0.82);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
		color: white;
	}

	.image-viewer-controls {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 4px;
		border-radius: 8px;
	}

	.image-viewer-control,
	.image-viewer-close {
		display: grid;
		place-items: center;
		border-radius: 5px;
		padding: 7px;
	}

	.image-viewer-control:hover:not(:disabled),
	.image-viewer-close:hover {
		background: rgba(255, 255, 255, 0.12);
	}

	.image-viewer-control:disabled {
		cursor: not-allowed;
		opacity: 0.35;
	}

	.image-viewer-zoom {
		min-width: 46px;
		padding: 0 4px;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
		text-align: center;
		color: rgba(255, 255, 255, 0.8);
	}

	.image-viewer-close {
		border-radius: 50%;
	}

	.image-viewer-stage {
		width: 100%;
		min-height: 0;
		flex: 1;
		display: grid;
		place-items: center;
		padding: 70px 28px 48px;
		border: 0;
		outline: 0;
		background: transparent;
		overflow: hidden;
		cursor: zoom-out;
		touch-action: none;
	}

	.image-viewer-stage:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent-color);
	}

	.image-viewer-image {
		display: block;
		max-width: min(92vw, 1400px);
		max-height: calc(100vh - 120px);
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 4px;
		box-shadow: 0 18px 70px rgba(0, 0, 0, 0.42);
		user-select: none;
		-webkit-user-drag: none;
		cursor: grab;
		transform-origin: center;
		transition: transform 160ms ease;
	}

	.image-viewer-stage.panning,
	.image-viewer-stage.panning .image-viewer-image {
		cursor: grabbing;
	}

	.image-viewer-stage.panning .image-viewer-image {
		transition: none;
	}

	.image-viewer-caption {
		position: absolute;
		bottom: 16px;
		max-width: min(80vw, 700px);
		margin: 0;
		font-size: 12px;
		text-align: center;
		color: rgba(255, 255, 255, 0.75);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.image-file-input {
		display: none;
	}

	.image-picker-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.28);
		z-index: 500;
	}

	.image-picker {
		position: fixed;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: min(420px, calc(100vw - 32px));
		background: var(--bg-sidebar);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
		padding: 18px;
		z-index: 501;
	}

	.image-picker-header {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 18px;
	}

	.image-picker-header h2 {
		font-size: 16px;
		margin: 0 0 4px;
	}

	.image-picker-header p {
		font-size: 13px;
		color: var(--text-muted);
		margin: 0;
	}

	.image-picker-close {
		font-size: 24px;
		line-height: 1;
		color: var(--text-muted);
		padding: 0 4px;
	}

	.image-upload-button {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 11px;
		border-radius: 6px;
		background: var(--accent-color);
		color: white;
		font-weight: 600;
	}

	.image-upload-button:disabled,
	.image-url-row button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	.image-picker-separator {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 16px 0;
		color: var(--text-muted);
		font-size: 12px;
	}

	.image-picker-separator::before,
	.image-picker-separator::after {
		content: '';
		flex: 1;
		border-top: 1px solid var(--border-color);
	}

	.image-url-label {
		display: block;
		font-size: 12px;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.image-url-row {
		display: flex;
		gap: 8px;
	}

	.image-url-row input {
		min-width: 0;
		flex: 1;
		border: 1px solid var(--border-color);
		background: var(--bg-canvas);
		color: var(--text-main);
		border-radius: 5px;
		padding: 8px 9px;
	}

	.image-url-row button {
		padding: 8px 12px;
		border-radius: 5px;
		background: var(--active-sidebar);
		color: var(--text-main);
		font-weight: 600;
	}

	.image-picker-error {
		margin: 10px 0 0;
		font-size: 12px;
		color: var(--error-color);
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

	.editor-bubble-menu.locked {
		display: none;
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
