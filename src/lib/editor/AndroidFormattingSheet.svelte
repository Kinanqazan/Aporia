<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import type { Mark } from '@tiptap/pm/model';
	import { ArrowLeft, Bold, Bookmark, Code, Feather, Italic, Link, Palette, Quote, Strikethrough, X } from 'lucide-svelte';
	import { getVisibleSelectionAnchor, positionAndroidFormattingPopover } from './android-formatting-layout';
	import type { createAndroidFormattingSelection } from './android-formatting-selection';
	import { convertSelectedParagraphs, type SelectionBlockType } from './selection-block-conversion';

	let { editor, session, colors, highlights, onvisible, onclose, onbookmark } = $props<{
		editor: Editor;
		session: ReturnType<typeof createAndroidFormattingSelection>;
		colors: { name: string; value: string }[];
		highlights: { name: string; value: string }[];
		onvisible: () => void;
		onclose: () => void;
		onbookmark: () => void;
	}>();
	let dialog: HTMLDialogElement;
	let revision = $state(0);
	let showLink = $state(false);
	let linkUrl = $state('');
	let picker = $state(false);
	let position = $state({ left: 8, top: 8 });
	let positioned = $state(false);
	let visibilityReported = false;
	const selected = $derived.by(() => { revision; return session.getSelection(editor.state); });

	function reportVisible() {
		if (visibilityReported || !dialog?.open) return;
		requestAnimationFrame(() => {
			if (visibilityReported || !dialog?.open || getComputedStyle(dialog).visibility !== 'visible' || !dialog.getBoundingClientRect().width) return;
			visibilityReported = true;
			onvisible();
		});
	}

	function active(mark: string) {
		revision;
		const range = session.getSelection(editor.state);
		return !!range && editor.state.doc.rangeHasMark(range.from, range.to, editor.schema.marks[mark]);
	}

	function chain() {
		const range = session.getSelection(editor.state);
		// Keep focus in the popover so formatting does not reopen Android's menu.
		return range && editor.isEditable ? editor.chain().setTextSelection({ from: range.from, to: range.to }) : null;
	}

	function placePopover() {
		if (!dialog?.open) return;
		const range = session.getSelection(editor.state);
		if (!range) {
			positioned = true;
			reportVisible();
			return;
		}

		let rect: DOMRect | null = null;
		try {
			const domRange = document.createRange();
			const from = editor.view.domAtPos(range.from);
			const to = editor.view.domAtPos(range.to);
			domRange.setStart(from.node, from.offset);
			domRange.setEnd(to.node, to.offset);
			const viewport = window.visualViewport;
			const focus = editor.view.coordsAtPos(range.head);
			const anchor = getVisibleSelectionAnchor(Array.from(domRange.getClientRects()), {
				left: viewport?.offsetLeft ?? 0,
				top: viewport?.offsetTop ?? 0,
				width: viewport?.width ?? window.innerWidth,
				height: viewport?.height ?? window.innerHeight
			}, { x: focus.left, y: (focus.top + focus.bottom) / 2 });
			if (anchor) {
				rect = new DOMRect(anchor.left, anchor.top, anchor.right - anchor.left, anchor.bottom - anchor.top);
			} else {
				const candidate = domRange.getBoundingClientRect();
				if (candidate.width || candidate.height) rect = candidate;
			}
		} catch {
			// Fall back to the editor's coordinates if the DOM range is temporarily unavailable.
			try {
				const from = editor.view.coordsAtPos(range.from);
				const to = editor.view.coordsAtPos(range.to);
				rect = new DOMRect(from.left, from.top, Math.max(1, to.right - from.left), Math.max(from.bottom, to.bottom) - from.top);
			} catch {
				rect = null;
			}
		}
		if (!rect) {
			positioned = true;
			reportVisible();
			return;
		}

		const viewport = window.visualViewport;
		const viewportLeft = viewport?.offsetLeft ?? 0;
		const viewportTop = viewport?.offsetTop ?? 0;
		const viewportWidth = viewport?.width ?? window.innerWidth;
		const viewportHeight = viewport?.height ?? window.innerHeight;
		const box = dialog.getBoundingClientRect();
		position = positionAndroidFormattingPopover(
			{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
			{ width: box.width || Math.min(320, viewportWidth - 16), height: box.height || 128 },
			{ left: viewportLeft, top: viewportTop, width: viewportWidth, height: viewportHeight }
		);
		positioned = true;
		reportVisible();
	}

	let positionFrame = 0;
	function schedulePosition() {
		cancelAnimationFrame(positionFrame);
		positionFrame = requestAnimationFrame(placePopover);
	}

	function applyTextColor(value: string) {
		if (value === 'var(--text-main)') chain()?.unsetColor().run();
		else chain()?.setColor(value).run();
		picker = false;
	}

	function applyHighlight(value: string) {
		if (value === 'transparent') chain()?.unsetHighlight().run();
		else chain()?.setHighlight({ color: value }).run();
		picker = false;
	}

	function convertSelection(type: SelectionBlockType) {
		const range = session.getSelection(editor.state);
		if (range && convertSelectedParagraphs(editor, type, range)) onclose();
	}

	onMount(() => {
		const update = () => {
			revision++;
			schedulePosition();
		};
		const outsidePointer = (event: PointerEvent) => {
			if (event.target instanceof Node && !dialog.contains(event.target)) onclose();
		};
		const cancel = (event: Event) => {
			event.preventDefault();
			onclose();
		};
		const viewport = window.visualViewport;
		dialog.show();
		editor.on('transaction', update);
		document.addEventListener('scroll', schedulePosition, true);
		document.addEventListener('pointerdown', outsidePointer, true);
		dialog.addEventListener('cancel', cancel);
		viewport?.addEventListener('resize', schedulePosition);
		viewport?.addEventListener('scroll', schedulePosition);
		window.addEventListener('resize', schedulePosition);
		schedulePosition();
		return () => {
			cancelAnimationFrame(positionFrame);
			document.removeEventListener('scroll', schedulePosition, true);
			document.removeEventListener('pointerdown', outsidePointer, true);
			dialog.removeEventListener('cancel', cancel);
			viewport?.removeEventListener('resize', schedulePosition);
			viewport?.removeEventListener('scroll', schedulePosition);
			window.removeEventListener('resize', schedulePosition);
			editor.off('transaction', update);
			if (dialog.open) dialog.close();
		};
	});
</script>

<dialog bind:this={dialog} class="format-popover" style:left={`${position.left}px`} style:top={`${position.top}px`} style:visibility={positioned ? 'visible' : 'hidden'} aria-label="Format selected text">
	{#if !selected}
		<p class="removed">The selected text was removed.</p>
	{:else if picker}
		<header>
			<button type="button" class="back" aria-label="Back to formatting" onclick={() => { picker = false; schedulePosition(); }}><ArrowLeft size={18} /></button>
			<span>Text color &amp; highlight</span>
			<button type="button" class="close" aria-label="Close formatting" onclick={onclose}><X size={18} /></button>
		</header>
		<div class="picker-label">Text color</div>
		<div class="swatches" role="group" aria-label="Text color choices">
				{#each colors as color}
					<button type="button" class="swatch" aria-label={color.name + ' text'} title={color.name} onclick={() => applyTextColor(color.value)}>
						<span style:color={color.value}>A</span>
					</button>
				{/each}
		</div>
		<div class="picker-label">Highlight</div>
		<div class="swatches" role="group" aria-label="Highlight choices">
				{#each highlights as highlight}
					<button type="button" class="swatch" aria-label={highlight.name} title={highlight.name} onclick={() => applyHighlight(highlight.value)}>
						<span class="highlight" style:background-color={highlight.value}>A</span>
					</button>
				{/each}
		</div>
	{:else}
		<header class="main-header">
			<span>Format</span>
			<button type="button" class="close" aria-label="Close formatting" onclick={onclose}><X size={18} /></button>
		</header>
		<div class="format-actions" role="group" aria-label="Text formatting">
			<button type="button" aria-label="Bold" aria-pressed={active('bold')} disabled={!selected} onclick={() => chain()?.toggleBold().run()}><Bold size={19} /></button>
			<button type="button" aria-label="Italic" aria-pressed={active('italic')} disabled={!selected} onclick={() => chain()?.toggleItalic().run()}><Italic size={19} /></button>
			<button type="button" aria-label="Strikethrough" aria-pressed={active('strike')} disabled={!selected} onclick={() => chain()?.toggleStrike().run()}><Strikethrough size={19} /></button>
			<button type="button" aria-label="Text color and highlight" disabled={!selected} onclick={() => { picker = true; schedulePosition(); }}><Palette size={19} /></button>
		</div>
		<div class="format-actions block-actions" role="group" aria-label="Links and blocks">
			<button type="button" aria-label="Inline code" aria-pressed={active('code')} disabled={!selected} onclick={() => chain()?.toggleCode().run()}><Code size={19} /></button>
			<button type="button" aria-label="Link" disabled={!selected} onclick={() => {
				const range = session.getSelection(editor.state);
				linkUrl = range ? editor.state.doc.nodeAt(range.from)?.marks.find((mark: Mark) => mark.type.name === 'link')?.attrs.href ?? '' : '';
				showLink = !showLink;
				schedulePosition();
			}}><Link size={19} /></button>
			<button type="button" aria-label="Insert link bookmark" disabled={!selected} onclick={onbookmark}><Bookmark size={19} /></button>
			<button type="button" aria-label="Turn selected paragraphs into a quote" disabled={!selected} onclick={() => convertSelection('blockquote')}><Quote size={19} /></button>
			<button type="button" aria-label="Turn selected paragraphs into poetry" disabled={!selected} onclick={() => convertSelection('poetry')}><Feather size={19} /></button>
		</div>
		{#if showLink}
			<form class="link-form" onsubmit={(event) => {
				event.preventDefault();
				const action = chain();
				if (linkUrl.trim()) action?.setLink({ href: linkUrl.trim() }).run();
				else action?.unsetLink().run();
				showLink = false;
				schedulePosition();
			}}>
				<input aria-label="Link address" inputmode="url" placeholder="https://…" bind:value={linkUrl} />
				<button type="submit" disabled={!selected}>Apply</button>
				<button type="button" disabled={!selected} onclick={() => { chain()?.unsetLink().run(); showLink = false; schedulePosition(); }}>Remove</button>
			</form>
		{/if}
	{/if}
</dialog>

<style>
	.format-popover {
		position: fixed;
		inset: auto;
		margin: 0;
		width: max-content;
		max-width: calc(100vw - 16px);
		max-height: min(220px, 55dvh);
		box-sizing: border-box;
		z-index: 2147483647;
		overflow: auto;
		padding: 6px 8px 8px;
		border: 1px solid var(--border-color);
		border-radius: 12px;
		background: var(--bg-sidebar);
		color: var(--text-main);
		box-shadow: 0 4px 20px #0008;
	}
	.format-popover::backdrop { background: transparent; }
	header { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 0 2px 4px; font-size: 12px; font-weight: 600; }
	header .close { margin-left: auto; }
	.main-header { padding-left: 6px; }
	button { min-width: 42px; min-height: 42px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; border-radius: 8px; color: var(--text-main); }
	button:hover, button[aria-pressed='true'] { background: var(--active-sidebar); color: var(--accent-color); }
	button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
	button:disabled { opacity: 0.4; }
	button.close, button.back { min-width: 32px; min-height: 30px; width: 32px; height: 30px; }
	.format-actions { display: flex; gap: 2px; justify-content: space-between; }
	.format-actions button { flex: 1 1 42px; }
	.block-actions { border-top: 1px solid var(--border-color); margin-top: 3px; padding-top: 3px; }
	.picker-label { padding: 5px 4px 2px; font-size: 12px; color: var(--text-muted); }
	.swatches { display: grid; grid-template-columns: repeat(5, 42px); gap: 2px; }
	.swatch { width: 42px; height: 42px; min-width: 42px; min-height: 42px; }
	.swatch span { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 5px; font-size: 18px; font-weight: 700; }
	.highlight { border: 1px solid var(--border-color); }
	.removed { margin: 4px 2px; font-size: 13px; }
	.link-form { display: flex; flex-wrap: wrap; gap: 4px; margin: 6px 0; }
	.link-form input { flex: 1 1 100%; min-width: 0; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-canvas); color: var(--text-main); }
	.link-form button { padding: 0 8px; min-height: 36px; }
</style>
