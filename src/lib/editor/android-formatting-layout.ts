type Bounds = { left: number; top: number; right: number; bottom: number };
type Size = { width: number; height: number };
type Viewport = { left: number; top: number; width: number; height: number };

function clamp(value: number, minimum: number, maximum: number) {
	return Math.max(minimum, Math.min(value, maximum));
}

// Position a compact selection toolbar without covering the text when either
// side of the selection has enough room. Prefer the space below the selection.
export function positionAndroidFormattingPopover(
	selection: Bounds,
	popover: Size,
	viewport: Viewport,
	margin = 8,
	gap = 8
) {
	const topLimit = viewport.top + margin;
	const bottomLimit = viewport.top + viewport.height - margin;
	const leftLimit = viewport.left + margin;
	const rightLimit = viewport.left + viewport.width - margin;
	const above = selection.top - popover.height - gap;
	const below = selection.bottom + gap;
	const fitsAbove = above >= topLimit;
	const fitsBelow = below + popover.height <= bottomLimit;
	let top: number;
	let placement: 'above' | 'below';

	if (fitsBelow) {
		top = below;
		placement = 'below';
	} else if (fitsAbove) {
		top = above;
		placement = 'above';
	} else {
		const spaceAbove = selection.top - topLimit - gap;
		const spaceBelow = bottomLimit - selection.bottom - gap;
		placement = spaceBelow >= spaceAbove ? 'below' : 'above';
		top = placement === 'below' ? below : above;
		top = clamp(top, topLimit, Math.max(topLimit, bottomLimit - popover.height));
	}

	return {
		left: clamp(
			(selection.left + selection.right - popover.width) / 2,
			leftLimit,
			Math.max(leftLimit, rightLimit - popover.width)
		),
		top,
		placement
	};
}
