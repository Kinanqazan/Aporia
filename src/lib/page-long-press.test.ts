import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { pageLongPress } from './page-long-press.js';

class TestRow extends EventTarget {
	ownerDocument = { defaultView: new EventTarget() };
	isControl = false;
	closest() { return this.isControl ? this : null; }
}

const previousElement = globalThis.Element;
globalThis.Element = TestRow as unknown as typeof Element;
after(() => { globalThis.Element = previousElement; });

function pointer(type: string, values: Record<string, unknown> = {}) {
	return Object.assign(new Event(type, { cancelable: true }), {
		pointerId: 1, isPrimary: true, button: 0, clientX: 30, clientY: 50, ...values
	});
}

function setup(enabled = true) {
	const row = new TestRow();
	let opens = 0;
	const options = { enabled, onOpen: () => { opens++; } };
	const action = pageLongPress(row as unknown as HTMLElement, options);
	return { row, view: row.ownerDocument.defaultView, action, options, opens: () => opens };
}

test('holding opens options once and consumes the release click without following the page', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const press = setup();
	press.row.dispatchEvent(pointer('pointerdown'));
	t.mock.timers.tick(449);
	assert.equal(press.opens(), 0);
	t.mock.timers.tick(1);
	assert.equal(press.opens(), 1);
	press.view.dispatchEvent(pointer('pointerup'));
	const click = Object.assign(new Event('click', { cancelable: true }), { detail: 1 });
	press.row.dispatchEvent(click);
	assert.equal(click.defaultPrevented, true);
	press.action.destroy();
});

test('a browser context-menu event after the hold does not reopen the options menu', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const press = setup();
	press.row.dispatchEvent(pointer('pointerdown'));
	t.mock.timers.tick(450);
	assert.equal(press.opens(), 1);

	const contextMenu = new Event('contextmenu', { cancelable: true });
	press.row.dispatchEvent(contextMenu);
	assert.equal(contextMenu.defaultPrevented, true);
	assert.equal(press.opens(), 1);

	press.view.dispatchEvent(pointer('pointerup'));
	const releaseClick = Object.assign(new Event('click', { cancelable: true }), { detail: 1 });
	press.row.dispatchEvent(releaseClick);
	assert.equal(releaseClick.defaultPrevented, true);
	press.action.destroy();
});

test('short taps navigate normally and a fresh tap after holding is not blocked', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	const press = setup();
	press.row.dispatchEvent(pointer('pointerdown'));
	t.mock.timers.tick(450);
	press.view.dispatchEvent(pointer('pointerup'));
	press.row.dispatchEvent(pointer('pointerdown'));
	t.mock.timers.tick(100);
	press.view.dispatchEvent(pointer('pointerup'));
	const click = Object.assign(new Event('click', { cancelable: true }), { detail: 1 });
	press.row.dispatchEvent(click);
	assert.equal(click.defaultPrevented, false);
	t.mock.timers.tick(500);
	assert.equal(press.opens(), 1);
	press.action.destroy();
});

test('scrolling and sidebar swipes cancel the hold before it opens a menu', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const movement of [{ clientX: 37 }, { clientY: 57 }]) {
		const press = setup();
		press.row.dispatchEvent(pointer('pointerdown'));
		press.view.dispatchEvent(pointer('pointermove', movement));
		t.mock.timers.tick(500);
		assert.equal(press.opens(), 0);
		press.action.destroy();
	}
});

test('pointer cancellation, a second finger, and losing focus cancel pending holds', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const event of [pointer('pointercancel'), pointer('pointerdown', { pointerId: 2 }), new Event('blur')]) {
		const press = setup();
		press.row.dispatchEvent(pointer('pointerdown'));
		press.view.dispatchEvent(event);
		t.mock.timers.tick(500);
		assert.equal(press.opens(), 0);
		press.action.destroy();
	}
});

test('buttons and rename fields retain their own behavior; desktop ignores holds', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const enabled of [true, false]) {
		const press = setup(enabled);
		press.row.isControl = enabled;
		press.row.dispatchEvent(pointer('pointerdown'));
		t.mock.timers.tick(500);
		assert.equal(press.opens(), 0);
		press.action.destroy();
	}
});

test('keyboard context-menu shortcut opens phone options without needing the dots', () => {
	const press = setup();
	const key = Object.assign(new Event('keydown', { cancelable: true }), { key: 'F10', shiftKey: true });
	press.row.dispatchEvent(key);
	assert.equal(press.opens(), 1);
	assert.equal(key.defaultPrevented, true);
	press.action.destroy();
});

test('disabling or removing a row cleans up its pending hold', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	for (const remove of [false, true]) {
		const press = setup();
		press.row.dispatchEvent(pointer('pointerdown'));
		if (remove) press.action.destroy();
		else press.action.update({ ...press.options, enabled: false });
		t.mock.timers.tick(500);
		assert.equal(press.opens(), 0);
		press.action.destroy();
	}
});
