/**
 * @param {any} dom
 * @param {boolean} isOpen
 */
export function synchronizeDetailsElement(dom, isOpen) {
	if (!dom?.classList?.toggle) return;
	dom.classList.toggle('is-open', isOpen);

	// DetailsContent node views always start with `hidden`. Arabic/RTL node
	// decorations can recreate that child while the parent remains open, so
	// Tiptap's parent update returns early and never toggles the new child.
	const content = dom.querySelector?.(':scope > div > [data-type="detailsContent"]');
	content?.toggleAttribute?.('hidden', !isOpen);
}

/**
 * Restores persisted toggle state after view-only interactions on a locked page.
 *
 * @param {{
 *   state: { doc: { descendants: (visit: (node: any, position: number) => void) => void } },
 *   view: { nodeDOM: (position: number) => any }
 * }} editor
 */
export function restorePersistedDetailsOpenState(editor) {
	editor.state.doc.descendants((node, position) => {
		if (node.type?.name !== 'details') return;
		synchronizeDetailsElement(editor.view.nodeDOM(position), Boolean(node.attrs?.open));
	});
}
