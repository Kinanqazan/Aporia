import assert from 'node:assert/strict';
import test from 'node:test';
import { createSidebarSwipe } from './sidebar-gesture.js';

/** @param {boolean} [open] @param {number} [progress] */
function start(open = false, progress = open ? 1 : 0) {
	// Start well outside the old 90px edge region.
	return createSidebarSwipe({ x: 210, y: 300, time: 0, width: 280, progress, open });
}

test('the drawer tracks distance immediately from anywhere and can reverse mid-swipe', () => {
	const swipe = start();
	assert.equal(swipe.move(238, 301, 60).progress, 0.1);
	assert.equal(swipe.move(350, 301, 180).progress, 0.5);
	assert.equal(swipe.move(266, 301, 280).progress, 0.2);
	assert.equal(swipe.move(700, 301, 400).progress, 1);
	assert.equal(swipe.move(100, 301, 500).progress, 0);
});

test('closing tracks the actual drawer width with the same one-to-one movement', () => {
	const swipe = start(true);
	assert.equal(swipe.move(182, 300, 70).progress, 0.9);
	assert.equal(swipe.move(70, 300, 230).progress, 0.5);
	assert.equal(swipe.move(-70, 300, 400).progress, 0);
});

test('slow partial drags settle to the closest endpoint after release', () => {
	const short = start();
	short.move(266, 300, 200);
	assert.deepEqual(short.release(400), { open: false, dragged: true });
	const pastHalf = start();
	pastHalf.move(378, 300, 300);
	assert.equal(pastHalf.release(500).open, true);
	const closing = start(true);
	closing.move(42, 300, 300);
	assert.equal(closing.release(500).open, false);
});

test('quick flicks open or close without requiring half the drawer width', () => {
	const opening = start();
	opening.move(250, 300, 50);
	assert.equal(opening.release(55).open, true);
	const closing = start(true);
	closing.move(170, 300, 50);
	assert.equal(closing.release(55).open, false);
});

test('release uses recent direction and does not treat a paused finger as a flick', () => {
	const reversing = start();
	reversing.move(406, 300, 180);
	reversing.move(350, 300, 240);
	assert.equal(reversing.release(245).open, false);
	const paused = start();
	paused.move(250, 300, 40);
	assert.equal(paused.release(200).open, false);
});

test('vertical scrolling stays vertical even if the finger later moves sideways', () => {
	const swipe = start();
	assert.equal(swipe.move(212, 316, 30).status, 'rejected');
	assert.equal(swipe.move(360, 330, 100).status, 'rejected');
	assert.deepEqual(swipe.release(110), { open: false, dragged: false });
});

test('taps, long presses, and swipes in an unavailable direction do not toggle', () => {
	const tap = start(true);
	assert.equal(tap.move(212, 300, 20).status, 'pending');
	assert.deepEqual(tap.release(40), { open: true, dragged: false });
	assert.equal(start().move(240, 300, 400).status, 'rejected');
	assert.equal(start().move(180, 300, 40).status, 'rejected');
	assert.equal(start(true).move(240, 300, 40).status, 'rejected');
});

test('a swipe can take over a partially completed opening or closing animation', () => {
	const interrupted = start(true, 0.4);
	assert.ok(Math.abs(interrupted.move(182, 300, 70).progress - 0.3) < 1e-10);
	assert.equal(interrupted.release(250).open, false);
});
