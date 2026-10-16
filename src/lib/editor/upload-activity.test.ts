import assert from 'node:assert/strict';
import test from 'node:test';
import { startUploadActivity } from './upload-activity.ts';

test('an upload keeps renewing until its saved page releases it', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	const actions: string[] = [];
	t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
		const body = JSON.parse(String(init.body));
		actions.push(body.action);
		if (body.action !== 'start') assert.equal(body.id, 'upload-session');
		return Response.json({ success: true, id: 'upload-session' });
	});
	const activity = await startUploadActivity();
	t.mock.timers.tick(30_000);
	await Promise.resolve();
	assert.deepEqual(actions, ['start', 'renew']);
	await activity.finish();
	t.mock.timers.tick(90_000);
	assert.deepEqual(actions, ['start', 'renew', 'finish']);
});

test('closing an unsaved editor stops renewal and lets the reservation expire', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	const actions: string[] = [];
	t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
		actions.push(JSON.parse(String(init.body)).action);
		return Response.json({ success: true, id: 'upload-session' });
	});
	const activity = await startUploadActivity();
	activity.abandon();
	t.mock.timers.tick(90_000);
	assert.deepEqual(actions, ['start']);
});

test('a failed renewal cancels requests using the upload signal', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
		if (JSON.parse(String(init.body)).action === 'renew') {
			return Response.json({ success: false, error: 'Session expired' }, { status: 409 });
		}
		return Response.json({ success: true, id: 'upload-session' });
	});
	const activity = await startUploadActivity();
	const aborted = new Promise(resolve => activity.signal.addEventListener('abort', resolve, { once: true }));
	t.mock.timers.tick(30_000);
	await aborted;
	assert.match(activity.signal.reason.message, /Session expired/);
	activity.abandon();
});

test('a failed finish stops renewal so cleanup can recover after expiry', async t => {
	t.mock.timers.enable({ apis: ['setInterval'] });
	const actions: string[] = [];
	t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
		const action = JSON.parse(String(init.body)).action;
		actions.push(action);
		if (action === 'finish') throw new Error('Connection lost');
		return Response.json({ success: true, id: 'upload-session' });
	});
	const activity = await startUploadActivity();
	await assert.rejects(activity.finish(), /Connection lost/);
	t.mock.timers.tick(90_000);
	assert.deepEqual(actions, ['start', 'finish']);
});
