<script lang="ts">
	import { onMount } from 'svelte';
	import type { Editor } from '@tiptap/core';
	import type { Mark } from '@tiptap/pm/model';
	import { Bold, Italic, Strikethrough, Code, Link, X } from 'lucide-svelte';
	import type { createAndroidFormattingSelection } from './android-formatting-selection';

	let { editor, session, colors, highlights, onclose } = $props<{
		editor: Editor;
		session: ReturnType<typeof createAndroidFormattingSelection>;
		colors: { name: string; value: string }[];
		highlights: { name: string; value: string }[];
		onclose: () => void;
	}>();
	let dialog: HTMLDialogElement;
	let revision = $state(0);
	let showLink = $state(false);
	let linkUrl = $state('');
	let viewportBottom = $state(0);
	let viewportHeight = $state<number>();
	const selected = $derived.by(() => { revision; return session.getSelection(editor.state); });

	function active(mark: string) {
		revision;
		const range = session.getSelection(editor.state);
		return !!range && editor.state.doc.rangeHasMark(range.from, range.to, editor.schema.marks[mark]);
	}

	function chain() {
		const range = session.getSelection(editor.state);
		// Do not focus the editor: the native menu has been dismissed and the
		// sheet owns focus. Commands still apply to the original selected range.
		return range && editor.isEditable ? editor.chain().setTextSelection({ from: range.from, to: range.to }) : null;
	}

	onMount(() => {
		const update = () => revision++;
		const viewport = window.visualViewport;
		const updateViewport = () => {
			viewportBottom = viewport ? Math.max(0, window.innerHeight - viewport.offsetTop - viewport.height) : 0;
			viewportHeight = (viewport?.height ?? window.innerHeight) * 0.65;
		};
		updateViewport();
		viewport?.addEventListener('resize', updateViewport);
		viewport?.addEventListener('scroll', updateViewport);
		window.addEventListener('resize', updateViewport);
		editor.on('transaction', update);
		dialog.showModal();
		return () => {
			viewport?.removeEventListener('resize', updateViewport);
			viewport?.removeEventListener('scroll', updateViewport);
			window.removeEventListener('resize', updateViewport);
			editor.off('transaction', update);
			dialog.close();
		};
	});
</script>

<dialog bind:this={dialog} class="format-sheet" style:bottom={`${viewportBottom}px`} style:max-height={viewportHeight ? `${viewportHeight}px` : undefined} aria-label="Format selected text" onclose={onclose}
	onclick={(event) => { if (event.target === dialog) onclose(); }}>
	<div class="sheet-content">
		<header><span>Format</span><button type="button" aria-label="Close formatting" onclick={onclose}><X size={20} /></button></header>
		{#if !selected}
			<p>The selected text was removed.</p>
		{/if}
		<div class="format-actions" role="group" aria-label="Text formatting">
			<button type="button" aria-label="Bold" aria-pressed={active('bold')} disabled={!selected} onclick={() => chain()?.toggleBold().run()}><Bold size={20} /></button>
			<button type="button" aria-label="Italic" aria-pressed={active('italic')} disabled={!selected} onclick={() => chain()?.toggleItalic().run()}><Italic size={20} /></button>
			<button type="button" aria-label="Strikethrough" aria-pressed={active('strike')} disabled={!selected} onclick={() => chain()?.toggleStrike().run()}><Strikethrough size={20} /></button>
			<button type="button" aria-label="Inline code" aria-pressed={active('code')} disabled={!selected} onclick={() => chain()?.toggleCode().run()}><Code size={20} /></button>
			<button type="button" aria-label="Link" aria-expanded={showLink} disabled={!selected} onclick={() => {
				const range = session.getSelection(editor.state);
				linkUrl = range ? editor.state.doc.nodeAt(range.from)?.marks.find((mark: Mark) => mark.type.name === 'link')?.attrs.href ?? '' : '';
				showLink = !showLink;
			}}><Link size={20} /></button>
		</div>
		{#if showLink}
			<form class="link-form" onsubmit={(event) => {
				event.preventDefault();
				const action = chain();
				if (linkUrl.trim()) action?.setLink({ href: linkUrl.trim() }).run();
				else action?.unsetLink().run();
				showLink = false;
			}}>
				<input aria-label="Link address" inputmode="url" placeholder="https://…" bind:value={linkUrl} />
				<button type="submit" disabled={!selected}>Apply</button>
				<button type="button" disabled={!selected} onclick={() => { chain()?.unsetLink().run(); showLink = false; }}>Remove</button>
			</form>
		{/if}
		<div class="palette" role="group" aria-label="Text color">
			<p>Text color</p>
			<div class="swatches">
				{#each colors as color}
					<button type="button" aria-label={color.name + ' text'} title={color.name} disabled={!selected}
						onclick={() => color.value === 'var(--text-main)' ? chain()?.unsetColor().run() : chain()?.setColor(color.value).run()}>
						<span style:color={color.value}>A</span>
					</button>
				{/each}
			</div>
		</div>
		<div class="palette" role="group" aria-label="Highlight">
			<p>Highlight</p>
			<div class="swatches">
				{#each highlights as highlight}
					<button type="button" aria-label={highlight.name} title={highlight.name} disabled={!selected}
						onclick={() => highlight.value === 'transparent' ? chain()?.unsetHighlight().run() : chain()?.setHighlight({ color: highlight.value }).run()}>
						<span class="highlight" style:background-color={highlight.value}>A</span>
					</button>
				{/each}
			</div>
		</div>
	</div>
</dialog>

<style>
	.format-sheet {
		position: fixed;
		inset: auto 0 0;
		margin: 0 auto;
		width: min(100%, 480px);
		max-width: 100%;
		max-height: 65dvh;
		box-sizing: border-box;
		overflow-y: auto;
		padding: 0;
		border: 1px solid var(--border-color);
		border-bottom: 0;
		border-radius: 16px 16px 0 0;
		background: var(--bg-sidebar);
		color: var(--text-main);
		box-shadow: 0 -4px 24px #0003;
	}
	.format-sheet::backdrop { background: #0004; }
	.sheet-content { padding: 12px 16px max(16px, env(safe-area-inset-bottom)); }
	header { display: flex; align-items: center; justify-content: space-between; font-weight: 600; }
	button { min-width: 44px; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: var(--text-main); }
	button:hover, button[aria-pressed='true'] { background: var(--active-sidebar); color: var(--accent-color); }
	button:focus-visible, input:focus-visible { outline: 2px solid var(--accent-color); outline-offset: 2px; }
	button:disabled { opacity: 0.4; }
	.format-actions { display: flex; gap: 6px; padding: 4px 0 8px; border-bottom: 1px solid var(--border-color); }
	.palette p { margin: 12px 0 4px; font-size: 12px; color: var(--text-muted); }
	.swatches { display: grid; grid-template-columns: repeat(5, minmax(44px, 1fr)); gap: 2px; }
	.swatches span { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 5px; font-size: 19px; font-weight: 700; }
	.highlight { border: 1px solid var(--border-color); }
	.link-form { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.link-form input { flex: 1 1 100%; min-width: 0; padding: 10px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-canvas); color: var(--text-main); }
	.link-form button { padding: 0 12px; }
</style>
