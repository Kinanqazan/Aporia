import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisibleSelectionAnchor, positionAndroidFormattingPopover } from './android-formatting-layout.ts';

test('a long selection anchors to the last visible line rather than the whole page', () => {
	const anchor = getVisibleSelectionAnchor([
		{ left: 20, top: 10, right: 250, bottom: 30 },
		{ left: 20, top: 440, right: 220, bottom: 460 },
		{ left: 20, top: 700, right: 220, bottom: 720 }
	], { left: 0, top: 0, width: 360, height: 600 });
	assert.deepEqual(anchor, { left: 20, top: 440, right: 220, bottom: 460 });
});

test('a backwards selection anchors near its active end', () => {
	const first = { left: 20, top: 100, right: 200, bottom: 120 };
	const last = { left: 20, top: 440, right: 220, bottom: 460 };
	assert.deepEqual(getVisibleSelectionAnchor([first, last],
		{ left: 0, top: 0, width: 390, height: 640 }, { x: 20, y: 110 }), first);
});

test('popover stays below a selected line when that avoids covering content above it', () => {
	const position = positionAndroidFormattingPopover(
		{ left: 56, top: 400, right: 304, bottom: 440 },
		{ width: 264, height: 136 },
		{ left: 0, top: 0, width: 360, height: 640 }
	);

	assert.equal(position.placement, 'below');
	assert.ok(position.top >= 448);
});

test('popover chooses the space above the selection when the keyboard removes room below', () => {
	const position = positionAndroidFormattingPopover(
		{ left: 56, top: 460, right: 304, bottom: 500 },
		{ width: 264, height: 136 },
		{ left: 0, top: 0, width: 360, height: 560 }
	);

	assert.equal(position.placement, 'above');
	assert.ok(position.top + 136 <= 452);
});
