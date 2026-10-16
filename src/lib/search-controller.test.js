import assert from 'node:assert/strict';
import test from 'node:test';
import { createSearchController } from './search-controller.js';

test('a late response never replaces results for a newer search', async () => {
	/** @type {Map<string, (results: string[]) => void>} */
	const requests = new Map();
	/** @type {string[]} */
	let results = [];
	const controller = createSearchController({
		search: (query) => new Promise((resolve) => requests.set(query, resolve)),
		onResults: (value) => results = value,
		onError: (error) => { throw error; }
	});
	const older = controller.update('old');
	const newer = controller.update('new');
	requests.get('new')?.(['new-page']);
	await newer;
	requests.get('old')?.(['old-page']);
	await older;
	assert.deepEqual(results, ['new-page']);
});

test('clearing or closing search invalidates a pending response', async () => {
	for (const close of [false, true]) {
		/** @type {(results: string[]) => void} */
		let resolve = () => {};
		/** @type {string[]} */
		let results = [];
		const controller = createSearchController({
			search: () => new Promise((done) => resolve = done),
			onResults: (value) => results = value,
			onError: (error) => { throw error; }
		});
		const pending = controller.update('old');
		if (close) controller.cancel();
		else await controller.update('');
		resolve(['stale-page']);
		await pending;
		assert.deepEqual(results, []);
	}
});
