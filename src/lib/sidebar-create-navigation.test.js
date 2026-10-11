import assert from 'node:assert/strict';
import test from 'node:test';
import { createSidebarCreateNavigation } from './sidebar-create-navigation.js';

/** @param {ReturnType<typeof createSidebarCreateNavigation>} navigation */
async function beginSubmit(navigation) {
	const formElement = /** @type {HTMLFormElement} */ ({});
	const action = new URL('/?/create', 'http://localhost');
	const result = await navigation.enhance({
		action,
		formData: new FormData(),
		formElement,
		controller: new AbortController(),
		submitter: null,
		cancel() {}
	});
	assert.equal(typeof result, 'function');
	if (typeof result !== 'function') throw new Error('Page-create enhancer did not return its result handler');
	return { result, formElement, action };
}

test('creating a subpage keeps the mobile drawer open through the redirect', async () => {
	let sidebarOpen = true;
	let menuOpen = true;
	const navigation = createSidebarCreateNavigation({
		isMobile: () => true,
		setSidebarOpen: (open) => { sidebarOpen = open; },
		onStart: () => { menuOpen = false; }
	});

	const { result: handleResult, formElement, action } = await beginSubmit(navigation);
	assert.equal(menuOpen, false);
	const afterSubmit = handleResult({
		formData: new FormData(),
		formElement,
		action,
		result: { type: 'redirect', status: 303, location: '/new-subpage' },
		update: async () => navigation.afterNavigate()
	});
	await afterSubmit;

	assert.equal(sidebarOpen, true);
});

test('ordinary mobile navigation still closes the drawer', () => {
	let sidebarOpen = true;
	const navigation = createSidebarCreateNavigation({
		isMobile: () => true,
		setSidebarOpen: (open) => { sidebarOpen = open; }
	});

	navigation.afterNavigate();
	assert.equal(sidebarOpen, false);
});

test('a failed page create clears drawer preservation for the next navigation', async () => {
	let sidebarOpen = true;
	const navigation = createSidebarCreateNavigation({
		isMobile: () => true,
		setSidebarOpen: (open) => { sidebarOpen = open; }
	});

	const { result: handleResult, formElement, action } = await beginSubmit(navigation);
	await handleResult({
		formData: new FormData(),
		formElement,
		action,
		result: { type: 'failure', status: 400, data: {} },
		update: async () => {}
	});
	navigation.afterNavigate();
	assert.equal(sidebarOpen, false);
});

test('page creation does not change desktop drawer behavior', async () => {
	let sidebarOpen = true;
	const navigation = createSidebarCreateNavigation({
		isMobile: () => false,
		setSidebarOpen: (open) => { sidebarOpen = open; }
	});

	const { result: handleResult, formElement, action } = await beginSubmit(navigation);
	await handleResult({
		formData: new FormData(),
		formElement,
		action,
		result: { type: 'redirect', status: 303, location: '/new-subpage' },
		update: async () => navigation.afterNavigate()
	});
	assert.equal(sidebarOpen, true);
});
