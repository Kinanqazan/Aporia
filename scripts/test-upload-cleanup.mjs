import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';

// Exercise the real cleanup endpoint against an isolated database and uploads.
// The normal workspace and its uploaded files are never used by this test.
const directory = await mkdtemp(join(tmpdir(), 'aporia-upload-cleanup-'));
const databasePath = join(directory, 'app.sqlite');
const port = 38000 + Math.floor(Math.random() * 10000);
const baseUrl = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['build/index.js'], {
	cwd: process.cwd(),
	env: {
		...process.env,
		HOST: '127.0.0.1', PORT: String(port), ORIGIN: baseUrl, NODE_ENV: 'production',
		DATABASE_URL: databasePath, UPLOAD_DIR: join(directory, 'uploads'),
		VERCEL: '', APORIA_DEMO_MODE: 'false'
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', (chunk) => output += chunk.toString());
child.stderr.on('data', (chunk) => output += chunk.toString());
let sqlite;

try {
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) throw new Error('Test server exited: ' + output);
		try {
			const response = await fetch(baseUrl + '/setup', { signal: AbortSignal.timeout(2000) });
			if (response.status === 200) { ready = true; break; }
		} catch {}
		await delay(200);
	}
	assert.ok(ready, 'Test server did not start: ' + output);
	const setup = await fetch(baseUrl + '/setup', {
		method: 'POST', redirect: 'manual',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseUrl },
		body: new URLSearchParams({
			username: 'cleanup-test', password: 'cleanup-password-123', confirmation: 'cleanup-password-123'
		})
	});
	assert.ok([200, 303].includes(setup.status), 'Private test workspace should finish setup');
	const cookie = setup.headers.get('set-cookie')?.split(';', 1)[0];
	assert.ok(cookie, 'Setup must create a browser session');
	sqlite = new Database(databasePath);
	const generation = randomUUID();
	sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('mcp_workspace_generation', generation);
	const emptyDocument = { type: 'doc', content: [{ type: 'paragraph' }] };
	const insertPage = sqlite.prepare(
		'INSERT INTO pages (id, title, content_json, is_in_trash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
	);
	function createPage(id, content = emptyDocument, trashed = false) {
		const now = new Date().toISOString();
		insertPage.run(id, id, JSON.stringify(content), Number(trashed), now, now);
	}
	async function request(path, init = {}) {
		return fetch(baseUrl + path, {
			...init, headers: { Cookie: cookie, Origin: baseUrl, ...init.headers }
		});
	}
	async function upload(name, bytes, mimeType, image = false) {
		const form = new FormData();
		form.set('pageId', 'live');
		form.set('file', new Blob([bytes], { type: mimeType }), name);
		const response = await request(image ? '/api/assets' : '/api/assets/attachment', { method: 'POST', body: form });
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.success, true);
		return { type: image ? 'image' : 'fileAttachment', attrs: image ? result.image : result.attachment };
	}
	async function savePage(id, content) {
		const revision = sqlite.prepare('SELECT revision FROM pages WHERE id = ?').get(id).revision;
		const response = await request('/api/pages/' + id, {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contentJson: JSON.stringify(content),
				expectedVersion: Buffer.from(generation + ':' + revision).toString('base64url')
			})
		});
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.success, true);
	}
	async function cleanup(expectedCount) {
		const response = await request('/api/assets/cleanup', { method: 'POST' });
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		assert.equal(result.success, true);
		assert.equal(result.removed, expectedCount);
		return result;
	}
	async function assertAsset(node, present) {
		const id = node.attrs.assetId;
		assert.equal(Boolean(sqlite.prepare('SELECT id FROM assets WHERE id = ?').get(id)), present);
		const response = await request('/assets/' + id);
		assert.equal(response.status, present ? 200 : 404);
		await response.arrayBuffer();
	}

	createPage('live');
	async function activity(action, id) {
		const response = await request('/api/assets/activity', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, id })
		});
		const result = await response.json();
		assert.equal(response.status, 200, JSON.stringify(result));
		return result.id;
	}
	const pendingActivity = await activity('start');
	const pendingFile = await upload('pending.pdf', '%PDF pending save', 'application/pdf');
	const busyCleanup = await request('/api/assets/cleanup', { method: 'POST' });
	assert.equal(busyCleanup.status, 409, 'Another tab must not delete an upload awaiting its first save');
	await assertAsset(pendingFile, true);
	await activity('renew', pendingActivity);
	await savePage('live', { type: 'doc', content: [pendingFile] });
	await activity('finish', pendingActivity);
	await cleanup(0);
	await assertAsset(pendingFile, true);
	await savePage('live', emptyDocument);
	await cleanup(1);
	await assertAsset(pendingFile, false);
	console.log('PASS: cleanup waits for an upload and its first save across clients, then immediately removes deleted blocks.');

	const cancelledActivity = await activity('start');
	const cancelledFile = await upload('cancelled.csv', 'cancelled', 'text/csv');
	await activity('finish', cancelledActivity);
	await activity('finish', cancelledActivity); // Closing a finished session is idempotent.
	await cleanup(1);
	await assertAsset(cancelledFile, false);
	const expiredActivity = await activity('start');
	const expiredFile = await upload('expired.json', '{}', 'application/json');
	sqlite.prepare('UPDATE upload_activity SET expires_at = 0 WHERE id = ?').run(expiredActivity);
	await cleanup(1);
	await assertAsset(expiredFile, false);
	assert.equal(sqlite.prepare('SELECT count(*) AS count FROM upload_activity').get().count, 0);
	console.log('PASS: cancelled uploads are removable and crashed sessions expire without blocking cleanup permanently.');

	sqlite.prepare('INSERT INTO upload_activity (id, kind, expires_at) VALUES (?, ?, ?)').run('cleanup-in-progress', 'cleanup', Date.now() + 60_000);
	const blockedStart = await request('/api/assets/activity', {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'start' })
	});
	assert.equal(blockedStart.status, 409);
	assert.equal((await request('/api/assets/cleanup', { method: 'POST' })).status, 409);
	const blockedSave = await request('/api/pages/live', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ contentJson: JSON.stringify(emptyDocument), expectedVersion: 'unused' })
	});
	assert.equal(blockedSave.status, 503, 'A busy cleanup must keep a page save retryable rather than reporting a version conflict');
	const blockedForm = new FormData();
	blockedForm.set('pageId', 'live');
	blockedForm.set('file', new Blob(['{}'], { type: 'application/json' }), 'blocked.json');
	assert.equal((await request('/api/assets/attachment', { method: 'POST', body: blockedForm })).status, 409);
	assert.equal(sqlite.prepare('SELECT count(*) AS count FROM assets').get().count, 0);
	sqlite.prepare('DELETE FROM upload_activity WHERE id = ?').run('cleanup-in-progress');
	console.log('PASS: cleanup excludes new uploads and concurrent cleanup requests.');

	const removedFile = await upload('removed.pdf', '%PDF-1.4\nfixture', 'application/pdf');
	const sharedFile = await upload('shared.json', '{"kept":true}', 'application/json');
	const trashFile = await upload('trash.csv', 'name,value\nkept,1', 'text/csv');
	const orphan = await upload('orphan.zip', 'PK fixture', 'application/zip');
	const image = await upload('removed.png', Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5nQAAAAASUVORK5CYII=', 'base64'
	), 'image/png', true);
	await savePage('live', { type: 'doc', content: [removedFile, sharedFile, image] });
	createPage('other', { type: 'doc', content: [{
		type: 'details', attrs: { open: false, level: 1 }, content: [
			{ type: 'detailsSummary', content: [{ type: 'text', text: 'Nested file' }] },
			{ type: 'detailsContent', content: [sharedFile] }
		]
	}] });
	createPage('trash', { type: 'doc', content: [trashFile] }, true);

	const first = await cleanup(1);
	assert.equal(first.bytesFreed, Buffer.byteLength('PK fixture'));
	await assertAsset(orphan, false);
	for (const node of [removedFile, sharedFile, image, trashFile]) await assertAsset(node, true);
	console.log('PASS: fresh unreferenced uploads are removed; live, nested, and Trash references are retained.');

	await savePage('live', emptyDocument);
	const removed = await cleanup(2);
	assert.equal(removed.bytesFreed, Buffer.byteLength('%PDF-1.4\nfixture') + Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5nQAAAAASUVORK5CYII=', 'base64'
	).length);
	await assertAsset(removedFile, false);
	await assertAsset(image, false);
	await assertAsset(sharedFile, true);
	assert.ok(sqlite.prepare('SELECT id FROM pages WHERE id = ?').get('live'), 'Removing blocks must not require deleting their page');
	console.log('PASS: removing file and image blocks from a surviving page makes their uploads immediately removable.');

	const protectedOrphan = await upload('protected.txt', 'keep until content is readable', 'text/plain');
	createPage('broken');
	sqlite.prepare('UPDATE pages SET content_json = ? WHERE id = ?').run('{broken', 'broken');
	const failedCleanup = await request('/api/assets/cleanup', { method: 'POST' });
	assert.equal(failedCleanup.status, 500);
	assert.match((await failedCleanup.json()).error, /page has invalid content/);
	await assertAsset(protectedOrphan, true);
	sqlite.prepare('UPDATE pages SET content_json = ? WHERE id = ?').run(JSON.stringify(emptyDocument), 'broken');
	await cleanup(1);
	await assertAsset(protectedOrphan, false);
	console.log('PASS: malformed page content stops cleanup without deleting uploads.');

	await savePage('other', emptyDocument);
	await cleanup(1);
	await assertAsset(sharedFile, false);
	await assertAsset(trashFile, true);
	await cleanup(0);
	console.log('PASS: shared uploads are deleted only after their last reference is removed; repeated cleanup is safe.');
} finally {
	sqlite?.close();
	if (child.exitCode === null) {
		child.kill();
		await once(child, 'exit');
	}
	assert.equal(dirname(directory), resolve(tmpdir()), 'Only remove the isolated test directory');
	await rm(directory, { recursive: true, force: true });
}
