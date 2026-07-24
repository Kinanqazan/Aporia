import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutosaveController } from './autosave-controller.js';

/** @typedef {{ promise: Promise<boolean>, resolve: (value: boolean) => void }} BooleanDeferred */
/** @typedef {{ payload: { pageId: string, contentJson: string }, result: BooleanDeferred }} SaveRequest */

/** @returns {BooleanDeferred} */
function deferred() {
	/** @type {(value: boolean) => void} */
	let resolve = () => {};
	const promise = new Promise((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test('a failed older request never replaces a newer pending edit', async () => {
	/** @type {SaveRequest[]} */
	const requests = [];
	const controller = createAutosaveController({
		debounceMs: 60_000,
		successIndicatorMs: 1,
		onStatusChange: () => {},
		save: (payload) => {
			const result = deferred();
			requests.push({ payload, result });
			return result.promise;
		}
	});

	controller.queue({ pageId: 'page', contentJson: 'older' });
	const firstFlush = controller.flush();
	await Promise.resolve();
	controller.queue({ pageId: 'page', contentJson: 'newest' });
	requests[0].result.resolve(false);
	assert.equal(await firstFlush, false);

	const retry = controller.flush();
	await Promise.resolve();
	assert.equal(requests[1].payload.contentJson, 'newest');
	requests[1].result.resolve(true);
	assert.equal(await retry, true);
	controller.destroy();
});

test('a failed save remains queued when another page has pending edits', async () => {
	const firstRequest = deferred();
	/** @type {string[]} */
	const attemptedPages = [];
	const controller = createAutosaveController({
		debounceMs: 60_000,
		onStatusChange: () => {},
		save: async (payload) => {
			attemptedPages.push(payload.pageId);
			if (attemptedPages.length === 1) return firstRequest.promise;
			return true;
		}
	});

	controller.queue({ pageId: 'page-a', contentJson: 'edit-a' });
	const firstFlush = controller.flush();
	await Promise.resolve();
	controller.queue({ pageId: 'page-b', contentJson: 'edit-b' });
	firstRequest.resolve(false);
	assert.equal(await firstFlush, false);

	assert.equal(await controller.flush(), true);
	assert.deepEqual(attemptedPages, ['page-a', 'page-b', 'page-a']);
	controller.destroy();
});

test('concurrent flush callers all wait for edits queued during an active save', async () => {
	/** @type {SaveRequest[]} */
	const requests = [];
	/** @type {Array<'idle' | 'saving' | 'error'>} */
	const statuses = [];
	const controller = createAutosaveController({
		debounceMs: 60_000,
		successIndicatorMs: 1,
		onStatusChange: (status) => statuses.push(status),
		save: (payload) => {
			const result = deferred();
			requests.push({ payload, result });
			return result.promise;
		}
	});

	controller.queue({ pageId: 'page', contentJson: 'first' });
	const backgroundFlush = controller.flush();
	await Promise.resolve();
	controller.queue({ pageId: 'page', contentJson: 'latest-before-lock' });
	const lockFlush = controller.flush();

	requests[0].result.resolve(true);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(requests[1].payload.contentJson, 'latest-before-lock');
	requests[1].result.resolve(true);
	assert.equal(await backgroundFlush, true);
	assert.equal(await lockFlush, true);

	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(statuses.at(-1), 'idle');
	controller.destroy();
});

test('queueing the already saved lock snapshot does not send a duplicate request', async () => {
	let requestCount = 0;
	let status = 'idle';
	const controller = createAutosaveController({
		onStatusChange: (nextStatus) => status = nextStatus,
		save: async () => {
			requestCount += 1;
			return true;
		}
	});

	controller.markSaved({ pageId: 'page', contentJson: 'saved-content' });
	controller.queue({ pageId: 'page', contentJson: 'saved-content' });
	assert.equal(await controller.flush(), true);
	assert.equal(requestCount, 0);
	assert.equal(status, 'idle');
	controller.destroy();
});
