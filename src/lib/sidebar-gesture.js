/** @param {number} value @param {number} min @param {number} max */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Track a single finger without committing the drawer state until release.
 * @param {{ x: number, y: number, time: number, width: number, progress: number, open: boolean }} start
 */
export function createSidebarSwipe(start) {
	let status = 'pending';
	let progress = start.progress;
	let distance = 0;
	let samples = [{ x: start.x, time: start.time }];

	return {
		/** @param {number} x @param {number} y @param {number} time */
		move(x, y, time) {
			const dx = x - start.x;
			const dy = y - start.y;
			if (status === 'pending' && Math.max(Math.abs(dx), Math.abs(dy)) >= 6) {
				// Yield vertical scrolling, long presses, and swipes away from the drawer.
				status = Math.abs(dx) > Math.abs(dy) * 1.2 && time - start.time < 350 &&
					!(start.progress <= 0 && dx < 0) && !(start.progress >= 1 && dx > 0)
					? 'dragging' : 'rejected';
			}
			if (status === 'dragging') {
				distance = dx;
				progress = clamp(start.progress + dx / start.width, 0, 1);
				samples.push({ x, time });
				// Use recent movement so reversing direction also reverses the flick.
				while (samples.length > 2 && samples[0].time < time - 100) samples.shift();
			}
			return { status, progress };
		},
		/** @param {number} time */
		release(time) {
			if (status !== 'dragging') return { open: start.open, dragged: false };
			const first = samples[0];
			const last = samples[samples.length - 1];
			const velocity = time - last.time < 100 && last.time > first.time
				? (last.x - first.x) / (last.time - first.time) : 0;
			const flick = Math.abs(velocity) >= 0.45 && Math.abs(distance) >= 12;
			return { open: flick ? velocity > 0 : progress >= 0.5, dragged: true };
		}
	};
}

/**
 * Svelte action: keep touch frames on the drawer's transform, outside rendering.
 * @param {HTMLElement} node
 * @param {{ enabled: boolean, open: boolean, onOpenChange: (open: boolean) => void }} options
 */
export function sidebarGesture(node, options) {
	const candidate = node.querySelector('.sidebar');
	if (!(candidate instanceof HTMLElement)) return {};
	const sidebar = candidate;
	let swipe = /** @type {ReturnType<typeof createSidebarSwipe> | null} */ (null);
	let touchId = -1;
	let origin = /** @type {Element | null} */ (null);
	let startX = 0;
	let dragging = false;
	let suppressClickUntil = 0;
	const view = node.ownerDocument.defaultView;

	/** @param {number} progress */
	function render(progress) {
		node.style.setProperty('--sidebar-progress', String(progress));
	}

	function reset() {
		if (dragging) suppressClickUntil = performance.now() + 500;
		swipe = null;
		dragging = false;
		node.classList.remove('sidebar-dragging');
		render(options.open ? 1 : 0);
	}

	/** @param {Element | null} target @param {number} dx */
	function canScrollHorizontally(target, dx) {
		for (let element = target; element && element !== node; element = element.parentElement) {
			if (element.scrollWidth <= element.clientWidth + 1) continue;
			if (!/auto|scroll/.test(view?.getComputedStyle(element).overflowX ?? '')) continue;
			if (dx < 0 && element.scrollLeft < element.scrollWidth - element.clientWidth - 1) return true;
			if (dx > 0 && element.scrollLeft > 1) return true;
		}
		return false;
	}

	/** @param {TouchEvent} event */
	function start(event) {
		if (event.touches.length !== 1) { reset(); return; }
		// A fresh tap after a swipe must work immediately.
		suppressClickUntil = 0;
		if (!options.enabled || event.defaultPrevented) return;
		origin = event.target instanceof Element ? event.target : null;
		if (origin?.closest('[role="dialog"], input[type="range"], .task-item-drag-handle, .column-resize-handle, [data-resize-handle]')) return;
		if (view?.getSelection()?.isCollapsed === false) return;
		const touch = event.touches[0];
		const rect = sidebar.getBoundingClientRect();
		if (rect.width <= 0) return;
		touchId = touch.identifier;
		startX = touch.clientX;
		swipe = createSidebarSwipe({
			x: touch.clientX, y: touch.clientY, time: event.timeStamp, width: rect.width,
			progress: clamp((rect.right - node.getBoundingClientRect().left) / rect.width, 0, 1),
			open: options.open
		});
	}

	/** @param {TouchEvent} event */
	function move(event) {
		if (!swipe) return;
		const touch = Array.from(event.touches).find((touch) => touch.identifier === touchId);
		if (event.touches.length !== 1 || !touch || !event.cancelable) { reset(); return; }
		const next = swipe.move(touch.clientX, touch.clientY, event.timeStamp);
		if (next.status === 'rejected') { swipe = null; return; }
		if (next.status !== 'dragging') return;
		if (!dragging && canScrollHorizontally(origin, touch.clientX - startX)) { swipe = null; return; }
		event.preventDefault();
		event.stopPropagation();
		dragging = true;
		node.classList.add('sidebar-dragging');
		render(next.progress);
	}

	/** @param {TouchEvent} event */
	function end(event) {
		if (!swipe) return;
		if (event.touches.length > 0) { reset(); return; }
		const result = swipe.release(event.timeStamp);
		reset();
		if (!result.dragged) return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
		render(result.open ? 1 : 0);
		options.onOpenChange(result.open);
	}

	/** @param {MouseEvent} event */
	function click(event) {
		if (event.detail !== 0 && performance.now() < suppressClickUntil) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}

	render(options.open ? 1 : 0);
	node.addEventListener('touchstart', start, { capture: true, passive: true });
	node.addEventListener('touchmove', move, { capture: true, passive: false });
	node.addEventListener('touchend', end, { capture: true, passive: false });
	node.addEventListener('touchcancel', reset, { capture: true, passive: true });
	node.addEventListener('click', click, true);
	return {
		/** @param {typeof options} next */
		update(next) {
			const changed = options.enabled !== next.enabled || options.open !== next.open;
			options = next;
			if (changed) reset();
		},
		destroy() {
			node.removeEventListener('touchstart', start, true);
			node.removeEventListener('touchmove', move, true);
			node.removeEventListener('touchend', end, true);
			node.removeEventListener('touchcancel', reset, true);
			node.removeEventListener('click', click, true);
			node.classList.remove('sidebar-dragging');
			node.style.removeProperty('--sidebar-progress');
		}
	};
}
