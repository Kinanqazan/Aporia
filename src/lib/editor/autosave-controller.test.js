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

test('a page mutation waits for saves and updates the version before later edits save', async () => {
	/** @type {Array<{ pageId: string, contentJson: string, expectedVersion?: string }>} */
	const saves = [];
	/** @type {{ finish: ((version: string) => void) | null }} */
	const pendingMutation = { finish: null };
	const controller = createAutosaveController({
		debounceMs: 60_000,
		onStatusChange: () => {},
		save: async (payload) => {
			saves.push(payload);
			return { success: true, version: saves.length === 1 ? 'v2' : 'v4' };
		}
	});
	controller.markSaved({ pageId: 'page', contentJson: 'original' }, 'v1');
	controller.queue({ pageId: 'page', contentJson: 'first edit' });
	let mutationVersion;
	const mutation = controller.runVersionedMutation('page', 'v1', (version) => {
		mutationVersion = version;
		return new Promise((resolve) => { pendingMutation.finish = resolve; });
	});
	while (!pendingMutation.finish) await new Promise((resolve) => setImmediate(resolve));
	assert.equal(mutationVersion, 'v2');
	controller.queue({ pageId: 'page', contentJson: 'later edit' });
	const flush = controller.flush();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(saves.length, 1);
	pendingMutation.finish('v3');
	await mutation;
	assert.equal(await flush, true);
	assert.equal(saves[1].expectedVersion, 'v3');
	controller.destroy();
});

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
	/** @type {Array<'idle' | 'saving' | 'error' | 'conflict'>} */
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

test('a queued edit uses the version returned by the preceding successful save', async () => {
	/** @type {Array<{ expectedVersion?: string }>} */
	const requests = [];
	const controller = createAutosaveController({
		debounceMs: 60_000,
		onStatusChange: () => {},
		save: async (payload) => {
			requests.push(payload);
			return { success: true, version: `version-${requests.length}` };
		}
	});
	controller.markSaved({ pageId: 'page', contentJson: 'saved' }, 'version-0');
	controller.queue({ pageId: 'page', contentJson: 'one' });
	const saving = controller.flush();
	await Promise.resolve();
	controller.queue({ pageId: 'page', contentJson: 'two' });
	assert.equal(await saving, true);
	assert.deepEqual(requests.map((request) => request.expectedVersion), ['version-0', 'version-1']);
	controller.destroy();
});

test('a conflict pauses autosave and keeps the local draft pending', async () => {
	let calls = 0;
	const controller = createAutosaveController({
		debounceMs: 60_000,
		onStatusChange: () => {},
		save: async () => { calls += 1; return { success: false, conflict: true }; }
	});
	controller.markSaved({ pageId: 'page', contentJson: 'saved' }, 'version-1');
	controller.queue({ pageId: 'page', contentJson: 'draft' });
	assert.equal(await controller.flush(), false);
	assert.equal(controller.hasConflict('page'), true);
	assert.equal(controller.isDirty('page'), true);
	controller.queue({ pageId: 'page', contentJson: 'newer draft' });
	assert.equal(await controller.flush(), false);
	assert.equal(calls, 1);
	controller.destroy();
});

test('an edit queued during a slow save uses that save\'s returned version', async () => {
	const firstRequest = deferred();
	/** @type {Array<string | undefined>} */
	const versions = [];
	const controller = createAutosaveController({
		debounceMs: 60_000,
		onStatusChange: () => {},
		save: async (payload) => {
			versions.push(payload.expectedVersion);
			if (versions.length === 1) await firstRequest.promise;
			return { success: true, version: `version-${versions.length}` };
		}
	});
	try {
		controller.markSaved({ pageId: 'page', contentJson: 'saved' }, 'version-0');
		controller.queue({ pageId: 'page', contentJson: 'one' });
		const saving = controller.flush();
		controller.queue({ pageId: 'page', contentJson: 'two' });
		firstRequest.resolve(true);
		assert.equal(await saving, true);
		assert.deepEqual(versions, ['version-0', 'version-1']);
	} finally {
		controller.destroy();
	}
});

test('a newer edit queued during a conflicting save stays paused until reload', async () => {
	const firstRequest = deferred();
	/** @type {string[]} */
	const attempts = [];
	const controller = createAutosaveController({
		debounceMs: 60_000,
		onStatusChange: () => {},
		save: async (payload) => {
			attempts.push(payload.contentJson);
			if (attempts.length === 1) {
				await firstRequest.promise;
				return { success: false, conflict: true };
			}
			return { success: true, version: 'version-2' };
		}
	});
	try {
		controller.markSaved({ pageId: 'page', contentJson: 'saved' }, 'version-0');
		controller.queue({ pageId: 'page', contentJson: 'one' });
		const saving = controller.flush();
		controller.queue({ pageId: 'page', contentJson: 'two' });
		firstRequest.resolve(true);
		assert.equal(await saving, false);
		assert.equal(await controller.flush(), false);
		assert.deepEqual(attempts, ['one']);
		assert.equal(controller.isDirty('page'), true);
		controller.markSaved({ pageId: 'page', contentJson: 'reloaded' }, 'version-1');
		assert.equal(await controller.flush(), true);
		assert.deepEqual(attempts, ['one']);
		assert.equal(controller.isDirty('page'), false);
	} finally {
		controller.destroy();
	}
});
