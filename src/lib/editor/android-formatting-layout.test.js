import assert from 'node:assert/strict';
import test from 'node:test';
import { positionAndroidFormattingPopover } from './android-formatting-layout.ts';

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
