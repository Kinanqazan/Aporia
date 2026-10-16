import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import JSZip from 'jszip';

// Use the actual built endpoints with a disposable workspace. Never open the
// developer's database or uploaded files.
const directory = await mkdtemp(join(tmpdir(), 'aporia-backup-'));
const uploadDirectory = join(directory, 'uploads');
const databasePath = join(directory, 'app.sqlite');
const port = 38000 + Math.floor(Math.random() * 10000);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['build/index.js'], {
	cwd: process.cwd(),
	env: {
		...process.env,
		HOST: '127.0.0.1', PORT: String(port), ORIGIN: baseUrl, NODE_ENV: 'production',
		DATABASE_URL: databasePath, UPLOAD_DIR: uploadDirectory,
		VERCEL: '', APORIA_DEMO_MODE: 'false'
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', chunk => output += chunk.toString());
child.stderr.on('data', chunk => output += chunk.toString());
let sqlite;
let cookie;
const failures = [];
const timestamp = new Date().toISOString();
const emptyDocument = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
const originalBytes = Buffer.from('original attachment');
const replacementBytes = Buffer.from('replacement attachment');
const attachment = {
	id: 'original-asset', storageKey: 'original-asset.txt', originalFilename: 'original.txt',
	mimeType: 'text/plain', byteSize: originalBytes.length, createdAt: timestamp
};

async function request(path, init = {}) {
	return fetch(baseUrl + path, { ...init, headers: { Cookie: cookie, Origin: baseUrl, ...init.headers } });
}

async function resetFixture() {
	sqlite.exec('DROP TRIGGER IF EXISTS reject_backup_test_page; DELETE FROM pages; DELETE FROM assets; DELETE FROM pages_fts; DELETE FROM upload_activity;');
	sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('auth.username', 'backup-test');
	sqlite.prepare('INSERT INTO pages (id, title, content_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
		.run('original-page', 'UniqueBackupSentinel', emptyDocument, timestamp, timestamp);
	sqlite.prepare('INSERT INTO assets (id, storage_key, original_filename, mime_type, byte_size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.run(attachment.id, attachment.storageKey, attachment.originalFilename, attachment.mimeType, attachment.byteSize, timestamp);
	await rm(uploadDirectory, { recursive: true, force: true });
	await mkdir(uploadDirectory, { recursive: true });
	await writeFile(join(uploadDirectory, attachment.storageKey), originalBytes);
}

async function archive({ pages, assets = [], settings = [], files = {}, rawAssets } = {}) {
	const zip = new JSZip();
	zip.file('manifest.json', JSON.stringify({ version: 1, exportedAt: timestamp, pageCount: pages.length, assetCount: assets.length }));
	zip.file('pages.json', JSON.stringify(pages));
	zip.file('assets.json', rawAssets ?? JSON.stringify(assets));
	zip.file('settings.json', JSON.stringify(settings));
	for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes);
	return zip.generateAsync({ type: 'uint8array' });
}

async function restore(bytes) {
	const form = new FormData();
	form.set('file', new Blob([bytes], { type: 'application/zip' }), 'test.aporia.zip');
	return request('/api/backup/restore', { method: 'POST', body: form });
}

function page(id = 'replacement-page', parentId = null) {
	return { id, parentId, title: id, contentJson: emptyDocument, createdAt: timestamp, updatedAt: timestamp };
}

async function expectUnchanged(response, status = 400) {
	assert.equal(response.status, status, await response.text());
	assert.deepEqual(sqlite.prepare('SELECT id FROM pages').all(), [{ id: 'original-page' }]);
	assert.deepEqual(await readFile(join(uploadDirectory, attachment.storageKey)), originalBytes);
	assert.deepEqual((await readdir(uploadDirectory)).sort(), [attachment.storageKey]);
}

async function check(name, action) {
	try {
		await resetFixture();
		await action();
		console.log(`PASS ${name}`);
	} catch (error) {
		failures.push(name);
		console.error(`FAIL ${name}: ${error.message}`);
	}
}

try {
	let ready = false;
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) throw new Error(`Test server exited: ${output}`);
		try {
			const response = await fetch(baseUrl + '/setup', { signal: AbortSignal.timeout(2000) });
			if (response.status === 200) { ready = true; break; }
		} catch {}
		await delay(200);
	}
	assert.ok(ready, `Test server did not start: ${output}`);
	const setup = await fetch(baseUrl + '/setup', {
		method: 'POST', redirect: 'manual',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseUrl },
		body: new URLSearchParams({ username: 'backup-test', password: 'backup-password-123', confirmation: 'backup-password-123' })
	});
	assert.ok([200, 303].includes(setup.status), 'Private test workspace should finish setup');
	cookie = setup.headers.get('set-cookie')?.split(';', 1)[0];
	assert.ok(cookie, 'Setup must create a browser session');
	sqlite = new Database(databasePath);

	await check('backup round trip indexes each page once and extracts only assets', async () => {
		const exported = await request('/api/backup/export');
		assert.equal(exported.status, 200);
		const restored = await restore(await exported.arrayBuffer());
		assert.equal(restored.status, 200, await restored.text());
		const search = await request('/api/search?q=UniqueBackupSentinel');
		assert.equal((await search.json()).results.length, 1, 'A restored page must appear once in search');
		assert.deepEqual((await readdir(uploadDirectory)).sort(), [attachment.storageKey], 'Metadata files must stay inside the ZIP');
		assert.deepEqual(await readFile(join(uploadDirectory, attachment.storageKey)), originalBytes);
	});
	await check('successful restore replaces asset bytes without leaving staging files', async () => {
		const response = await restore(await archive({
			pages: [page()], assets: [{ ...attachment, byteSize: replacementBytes.length }],
			files: { [`assets/${attachment.storageKey}`]: replacementBytes }
		}));
		assert.equal(response.status, 200, await response.text());
		assert.deepEqual(sqlite.prepare('SELECT id FROM pages').all(), [{ id: 'replacement-page' }]);
		assert.deepEqual(await readFile(join(uploadDirectory, attachment.storageKey)), replacementBytes);
		assert.deepEqual(await readdir(uploadDirectory), [attachment.storageKey]);
	});
	await check('older pages-only backups restore defaults and child-first page order', async () => {
		const zip = new JSZip();
		zip.file('pages.json', JSON.stringify([{ id: 'older-child', parentId: 'older-parent' }, { id: 'older-parent' }]));
		const response = await restore(await zip.generateAsync({ type: 'uint8array' }));
		assert.equal(response.status, 200, await response.text());
		assert.deepEqual(sqlite.prepare('SELECT id, parent_id, revision FROM pages ORDER BY id').all(), [
			{ id: 'older-child', parent_id: 'older-parent', revision: 1 },
			{ id: 'older-parent', parent_id: null, revision: 1 }
		]);
		assert.equal(sqlite.pragma('foreign_keys', { simple: true }), 1);
	});

	await check('missing archived asset preserves the workspace', async () => {
		await expectUnchanged(await restore(await archive({ pages: [page()], assets: [attachment] })));
	});
	await check('dangling image and attachment references preserve the workspace', async () => {
		for (const node of [
			{ type: 'image', attrs: { source: 'upload', assetId: attachment.id, src: `/assets/${attachment.id}` } },
			{ type: 'fileAttachment', attrs: { assetId: attachment.id, fileName: attachment.originalFilename, mimeType: attachment.mimeType, size: attachment.byteSize } }
		]) {
			const contentJson = JSON.stringify({ type: 'doc', content: [node] });
			await expectUnchanged(await restore(await archive({ pages: [{ ...page(), contentJson }] })));
		}
	});
	await check('attachment metadata must match its restored asset', async () => {
		const contentJson = JSON.stringify({ type: 'doc', content: [{ type: 'fileAttachment', attrs: {
			assetId: attachment.id, fileName: 'incorrect.txt', mimeType: attachment.mimeType, size: attachment.byteSize
		} }] });
		await expectUnchanged(await restore(await archive({
			pages: [{ ...page(), contentJson }], assets: [attachment], files: { [`assets/${attachment.storageKey}`]: originalBytes }
		})));
	});
	await check('malformed assets metadata preserves the workspace', async () => {
		await expectUnchanged(await restore(await archive({ pages: [page()], rawAssets: '{broken JSON' })));
	});
	await check('asset byte-size mismatch preserves the workspace', async () => {
		await expectUnchanged(await restore(await archive({ pages: [page()], assets: [attachment], files: { [`assets/${attachment.storageKey}`]: 'wrong' } })));
	});
	await check('a ZIP checksum error preserves the workspace', async () => {
		const bytes = Buffer.from(await archive({ pages: [page()], assets: [attachment], files: { [`assets/${attachment.storageKey}`]: originalBytes } }));
		const assetOffset = bytes.indexOf(originalBytes);
		assert.ok(assetOffset >= 0, 'Uncompressed test asset should appear in the ZIP');
		bytes[assetOffset] ^= 1;
		await expectUnchanged(await restore(bytes));
	});
	await check('unlisted archive member preserves the workspace', async () => {
		await expectUnchanged(await restore(await archive({ pages: [page()], files: { 'assets/unlisted.txt': 'unexpected' } })));
	});
	await check('unsafe asset storage key cannot write outside uploads', async () => {
		const outsideDirectory = join(directory, 'uploads-evil');
		await mkdir(outsideDirectory);
		const storageKey = '..\\uploads-evil\\owned.txt';
		const unsafeAsset = { ...attachment, storageKey, byteSize: 4 };
		const response = await restore(await archive({ pages: [page()], assets: [unsafeAsset], files: { [`assets/${storageKey}`]: 'evil' } }));
		assert.deepEqual(await readdir(outsideDirectory), [], 'No files should be created in a sibling directory');
		await expectUnchanged(response);
	});
	await check('unsafe Windows storage keys are rejected on every platform', async () => {
		for (const storageKey of ['asset.txt:secret', 'a/b.txt', 'a\\b.txt', 'NUL.txt', 'asset.txt.', 'asset.txt ', 'asset?.txt']) {
			await expectUnchanged(await restore(await archive({
				pages: [page()], assets: [{ ...attachment, storageKey }],
				files: { [`assets/${storageKey}`]: originalBytes }
			})));
		}
	});
	await check('invalid page tree preserves the workspace', async () => {
		await expectUnchanged(await restore(await archive({ pages: [page('cycle-a', 'cycle-b'), page('cycle-b', 'cycle-a')] })));
	});
	await check('authentication settings are excluded from restore', async () => {
		const passwordHash = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('auth.password.hash').value;
		const response = await restore(await archive({
			pages: [page()], settings: [
				{ key: 'auth.username', value: 'unexpected-user' },
				{ key: 'auth.password.hash', value: 'unexpected-password' },
				{ key: 'aporia-editor-text-size:replacement-page', value: '18' }
			]
		}));
		assert.equal(response.status, 200, await response.text());
		assert.equal(sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('auth.username').value, 'backup-test');
		assert.equal(sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('auth.password.hash').value, passwordHash);
		assert.equal(sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('aporia-editor-text-size:replacement-page').value, '18');
	});
	await check('database failure restores overwritten upload files', async () => {
		sqlite.exec("CREATE TRIGGER reject_backup_test_page BEFORE INSERT ON pages WHEN new.id = 'transaction-failure' BEGIN SELECT RAISE(ABORT, 'Forced test failure'); END;");
		await expectUnchanged(await restore(await archive({
			pages: [page('transaction-failure')], assets: [{ ...attachment, byteSize: replacementBytes.length }],
			files: { [`assets/${attachment.storageKey}`]: replacementBytes }
		})));
	});
	await check('upload destination failure preserves the workspace', async () => {
		await mkdir(join(uploadDirectory, 'blocked.txt'));
		const blockedAsset = { ...attachment, id: 'blocked', storageKey: 'blocked.txt', byteSize: 4 };
		const response = await restore(await archive({ pages: [page()], assets: [blockedAsset], files: { 'assets/blocked.txt': 'data' } }));
		assert.equal(response.status, 400, await response.text());
		assert.deepEqual(sqlite.prepare('SELECT id FROM pages').all(), [{ id: 'original-page' }]);
		assert.deepEqual(await readFile(join(uploadDirectory, attachment.storageKey)), originalBytes);
		assert.deepEqual((await readdir(uploadDirectory)).sort(), ['blocked.txt', attachment.storageKey]);
	});
	await check('export reports a missing uploaded file', async () => {
		await rm(join(uploadDirectory, attachment.storageKey));
		assert.equal((await request('/api/backup/export')).status, 500);
	});
	await check('active upload blocks restore without changing the workspace', async () => {
		sqlite.prepare('INSERT INTO upload_activity (id, kind, expires_at) VALUES (?, ?, ?)').run('busy-upload', 'upload', Date.now() + 60_000);
		await expectUnchanged(await restore(await archive({ pages: [page()] })), 409);
	});
	await check('active cleanup blocks export and restore', async () => {
		sqlite.prepare('INSERT INTO upload_activity (id, kind, expires_at) VALUES (?, ?, ?)').run('busy-cleanup', 'cleanup', Date.now() + 60_000);
		assert.equal((await request('/api/backup/export')).status, 409);
		await expectUnchanged(await restore(await archive({ pages: [page()] })), 409);
	});

	assert.equal(failures.length, 0, `${failures.length} backup regression checks failed: ${failures.join(', ')}`);
	console.log('Backup integration passed: round trip, FTS uniqueness, archive validation, authentication isolation, and filesystem/database rollback.');
} finally {
	sqlite?.close();
	if (child.exitCode === null) {
		const exited = once(child, 'exit');
		child.kill();
		await exited;
	}
	await rm(directory, { recursive: true, force: true });
}
