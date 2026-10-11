/**
 * Open a page's options without allowing the hold's release to follow its link.
 * @param {HTMLElement} node
 * @param {{ enabled: boolean, onOpen: (row: HTMLElement) => void }} options
 */
export function pageLongPress(node, options) {
	const view = node.ownerDocument.defaultView;
	let timer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
	let pointerId = -1;
	let startX = 0;
	let startY = 0;
	let suppressClick = false;

	function cancel() {
		clearTimeout(timer);
		timer = undefined;
		view?.removeEventListener('pointermove', move, true);
		view?.removeEventListener('pointerup', cancel, true);
		view?.removeEventListener('pointercancel', cancel, true);
		view?.removeEventListener('pointerdown', otherPointer, true);
		view?.removeEventListener('blur', cancel);
	}

	/** @param {PointerEvent} event */
	function move(event) {
		if (event.pointerId === pointerId && Math.hypot(event.clientX - startX, event.clientY - startY) >= 6) cancel();
	}

	/** @param {PointerEvent} event */
	function otherPointer(event) {
		if (event.pointerId !== pointerId) cancel();
	}

	/** @param {PointerEvent} event */
	function start(event) {
		cancel();
		suppressClick = false;
		if (!options.enabled || !event.isPrimary || event.button !== 0) return;
		const target = event.target;
		if (target instanceof Element && target.closest('button, input, form, .page-options-dropdown')) return;
		pointerId = event.pointerId;
		startX = event.clientX;
		startY = event.clientY;
		view?.addEventListener('pointermove', move, true);
		view?.addEventListener('pointerup', cancel, true);
		view?.addEventListener('pointercancel', cancel, true);
		view?.addEventListener('pointerdown', otherPointer, true);
		view?.addEventListener('blur', cancel);
		timer = setTimeout(() => {
			suppressClick = true;
			options.onOpen(node);
		}, 450);
	}

	/** @param {MouseEvent} event */
	function click(event) {
		if (!suppressClick || event.detail === 0) return;
		suppressClick = false;
		event.preventDefault();
		event.stopImmediatePropagation();
	}

	/** @param {MouseEvent} event */
	function contextMenu(event) {
		if (!options.enabled) return;
		event.preventDefault();
		event.stopPropagation();
		cancel();
		suppressClick = true;
		options.onOpen(node);
	}

	/** @param {KeyboardEvent} event */
	function keydown(event) {
		if (options.enabled && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
			event.preventDefault();
			options.onOpen(node);
		}
	}

	node.addEventListener('pointerdown', start);
	node.addEventListener('click', click, true);
	node.addEventListener('contextmenu', contextMenu);
	node.addEventListener('keydown', keydown);
	return {
		/** @param {typeof options} next */
		update(next) {
			options = next;
			if (!options.enabled) { cancel(); suppressClick = false; }
		},
		destroy() {
			cancel();
			node.removeEventListener('pointerdown', start);
			node.removeEventListener('click', click, true);
			node.removeEventListener('contextmenu', contextMenu);
			node.removeEventListener('keydown', keydown);
		}
	};
}
