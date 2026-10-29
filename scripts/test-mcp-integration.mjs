import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const directory = await mkdtemp(join(tmpdir(), 'aporia-mcp-'));
const port = 38000 + Math.floor(Math.random() * 10000);
const token = 'mcp-integration-test-token-' + 'a'.repeat(40);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['build/index.js'], {
	cwd: process.cwd(),
	env: {
		...process.env,
		HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'production',
		ORIGIN: baseUrl,
		DATABASE_URL: join(directory, 'app.sqlite'), UPLOAD_DIR: join(directory, 'uploads'),
		APORIA_MCP_ENABLED: 'true', APORIA_MCP_TOKEN: token,
		APORIA_MCP_ALLOWED_ORIGINS: baseUrl
	},
	stdio: ['ignore', 'pipe', 'pipe']
});
let childOutput = '';
child.stdout.on('data', (chunk) => childOutput += chunk.toString());
child.stderr.on('data', (chunk) => childOutput += chunk.toString());
const clients = [];

async function connect(name) {
	const client = new Client({ name, version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
	const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
		requestInit: { headers: { Authorization: `Bearer ${token}` } }
	});
	await client.connect(transport);
	clients.push({ client, transport });
	return client;
}

async function verifyPageControls(client, clientTwo, sessionCookie) {
	const call = async (name, args) => {
		const response = await client.callTool({ name, arguments: args });
		assert.equal(response.isError, undefined, JSON.stringify(response));
		assert.equal('contentJson' in response.structuredContent.result.page, false);
		return response.structuredContent.result;
	};
	const expectError = async (name, args, code) => {
		const response = await client.callTool({ name, arguments: args });
		assert.equal(response.isError, true, JSON.stringify(response));
		assert.equal(response.structuredContent.result.error.code, code);
	};
	const document = { type: 'doc', content: [
		{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Keep this heading' }] },
		{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this formatting', marks: [{ type: 'bold' }] }] }
	] };
	const args = { operationId: 'integration-page-controls', title: 'Page controls', content: document,
		icon: 'lucide:book-open', iconColor: '#8b5cf6', isFullWidth: true, isLocked: true };
	let { page } = await call('create_page', args);
	assert.equal(page.icon, args.icon);
	assert.equal(page.iconColor, args.iconColor);
	assert.equal(page.isFullWidth, 1);
	assert.equal(page.isLocked, 1);
	assert.equal((await call('create_page', args)).page.id, page.id, 'customized creation must be retryable');
	await expectError('create_page', { ...args, icon: 'lucide:star' }, 'INVALID_INPUT');
	const invalidColor = await client.callTool({ name: 'update_page', arguments: { id: page.id, expectedVersion: page.version, iconColor: '#123456' } });
	assert.equal(invalidColor.isError, true, 'unsupported colors must be rejected');
	const invalidLock = await client.callTool({ name: 'set_page_lock', arguments: { id: page.id, expectedVersion: page.version, isLocked: 'false' } });
	assert.equal(invalidLock.isError, true, 'lock state must be a boolean');
	await expectError('set_page_lock', { id: 'missing-page', expectedVersion: page.version, isLocked: false }, 'NOT_FOUND');
	const unchanged = await call('set_page_lock', { id: page.id, expectedVersion: page.version, isLocked: true });
	assert.equal(unchanged.changed, false);
	assert.equal(unchanged.page.version, page.version, 'same-state lock must preserve version');
	assert.equal(unchanged.page.updatedAt, page.updatedAt);
	const block = { type: 'paragraph', content: [{ type: 'text', text: 'Appended note' }] };
	for (const [name, fields] of [
		['update_page', { title: 'Blocked rename' }], ['update_page', { icon: 'lucide:star' }],
		['move_page', { parentId: null }], ['trash_page', {}],
		['set_page_layout', { isFullWidth: false }], ['append_page_content', { blocks: [block] }]
	]) await expectError(name, { id: page.id, expectedVersion: page.version, ...fields }, 'LOCKED');
	const lockedVersion = page.version;
	page = (await call('set_page_lock', { id: page.id, expectedVersion: page.version, isLocked: false })).page;
	assert.equal(page.isLocked, 0);
	assert.notEqual(page.version, lockedVersion);
	await expectError('set_page_lock', { id: page.id, expectedVersion: lockedVersion, isLocked: true }, 'CONFLICT');
	await expectError('update_page', { id: page.id, expectedVersion: lockedVersion, title: 'Stale rename' }, 'CONFLICT');
	page = (await call('update_page', { id: page.id, expectedVersion: page.version, title: 'Updated controls', icon: '⭐', iconColor: '#22c55e' })).page;
	assert.equal(page.icon, '⭐');
	assert.equal(page.iconColor, '#22c55e');
	assert.equal(page.isFullWidth, 1, 'metadata edit must preserve layout');
	const metadataVersion = page.version;
	page = (await call('set_page_layout', { id: page.id, expectedVersion: page.version, isFullWidth: false })).page;
	assert.equal(page.isFullWidth, 0);
	assert.notEqual(page.version, metadataVersion);
	const sameLayout = await call('set_page_layout', { id: page.id, expectedVersion: page.version, isFullWidth: false });
	assert.equal(sameLayout.changed, false);
	assert.equal(sameLayout.page.version, page.version);
	const beforeAppend = page.version;
	page = (await call('append_page_content', { id: page.id, expectedVersion: page.version, blocks: [block] })).page;
	assert.equal(page.title, 'Updated controls');
	assert.equal(page.icon, '⭐');
	const read = await call('read_page', { id: page.id });
	assert.deepEqual(read.document, { ...document, content: [...document.content, block] }, 'append must preserve all existing nodes and marks');
	await expectError('append_page_content', { id: page.id, expectedVersion: beforeAppend, blocks: [block] }, 'CONFLICT');
	await expectError('append_page_content', { id: page.id, expectedVersion: page.version, blocks: [{ type: 'unknownBlock' }] }, 'INVALID_INPUT');
	const emptyAppend = await client.callTool({ name: 'append_page_content', arguments: { id: page.id, expectedVersion: page.version, blocks: [] } });
	assert.equal(emptyAppend.isError, true);
	const afterInvalid = await call('read_page', { id: page.id });
	assert.equal(afterInvalid.page.version, page.version, 'rejected appends must not change saved state');
	assert.deepEqual(afterInvalid.document, read.document, 'retry and invalid append must not duplicate or remove content');
	page = (await call('update_page', { id: page.id, expectedVersion: page.version, icon: null, iconColor: null, isFullWidth: true })).page;
	assert.equal(page.icon, null);
	assert.equal(page.iconColor, null);
	assert.equal(page.isFullWidth, 1);
	const noop = await call('update_page', { id: page.id, expectedVersion: page.version, icon: null, iconColor: null });
	assert.equal(noop.changed, false);
	assert.equal(noop.page.version, page.version);
	await expectError('update_page', { id: page.id, expectedVersion: page.version }, 'INVALID_INPUT');

	// Two clients starting from the same version must not both change the page.
	const [lockRace, editRace] = await Promise.all([
		client.callTool({ name: 'set_page_lock', arguments: { id: page.id, expectedVersion: page.version, isLocked: true } }),
		clientTwo.callTool({ name: 'update_page', arguments: { id: page.id, expectedVersion: page.version, title: 'Concurrent title' } })
	]);
	assert.equal([lockRace, editRace].filter(response => !response.isError).length, 1, 'only one concurrent write can win');
	assert.equal([lockRace, editRace].find(response => response.isError).structuredContent.result.error.code, 'CONFLICT');
	page = (await call('read_page', { id: page.id })).page;
	page = (await call('set_page_lock', { id: page.id, expectedVersion: page.version, isLocked: true })).page;
	const staleBrowserUnlock = await fetch(`${baseUrl}/api/pages/${page.id}/lock`, {
		method: 'POST', headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ expectedVersion: metadataVersion, isLocked: false })
	});
	assert.equal(staleBrowserUnlock.status, 409, 'stale browser unlock must not bypass MCP changes');
	const browserUnlock = await fetch(`${baseUrl}/api/pages/${page.id}/lock`, {
		method: 'POST', headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ expectedVersion: page.version, isLocked: false })
	});
	assert.equal(browserUnlock.status, 200);
	const unlocked = await browserUnlock.json();
	await expectError('set_page_lock', { id: page.id, expectedVersion: page.version, isLocked: true }, 'CONFLICT');
	page = (await call('trash_page', { id: page.id, expectedVersion: unlocked.version })).page;
	for (const [name, fields] of [
		['set_page_lock', { isLocked: false }], ['set_page_layout', { isFullWidth: false }],
		['append_page_content', { blocks: [block] }]
	]) await expectError(name, { id: page.id, expectedVersion: page.version, ...fields }, 'NOT_FOUND');
}

async function verifyShareTargets(client, sessionCookie) {
	const original = { type: 'paragraph', content: [{ type: 'text', text: 'Preserved page content', marks: [{ type: 'bold' }] }] };
	const created = await client.callTool({ name: 'create_page', arguments: {
		operationId: 'integration-share-parent', title: 'Locked share parent', isLocked: true,
		content: { type: 'doc', content: [original] }
	} });
	let page = created.structuredContent.result.page;
	const childPage = await client.callTool({ name: 'create_page', arguments: {
		operationId: 'integration-share-child', title: 'Locked share child', parentId: page.id, isLocked: true
	} });
	assert.equal(childPage.isError, undefined, 'locked parents must retain selectable child destinations');
	const post = async (payload) => fetch(`${baseUrl}/api/share-target`, {
		method: 'POST', headers: { Cookie: sessionCookie, Origin: baseUrl, 'Content-Type': 'application/json' },
		body: JSON.stringify({ targetPageId: page.id, ...payload })
	});
	const postFiles = async (files, shareId) => {
		const form = new FormData();
		form.set('targetPageId', page.id);
		form.set('shareId', shareId);
		for (const file of files) form.append('files', file);
		return fetch(`${baseUrl}/api/share-target`, { method: 'POST', headers: { Cookie: sessionCookie, Origin: baseUrl }, body: form });
	};
	const photo = new File([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGo0AAAAASUVORK5CYII=', 'base64')], 'photo.png', { type: 'image/png' });
	const attachment = new File(['Shared file body'], 'shared.txt', { type: 'text/plain' });
	assert.equal((await post({ text: 'Blocked text' })).status, 423);
	assert.equal((await post({ url: 'https://example.com/shared' })).status, 423);
	assert.equal((await postFiles([photo], 'blocked-photo')).status, 423);
	assert.equal((await postFiles([attachment], 'blocked-file')).status, 423);
	const unlock = await fetch(`${baseUrl}/api/pages/${page.id}/lock`, {
		method: 'POST', headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ isLocked: false, expectedVersion: page.version })
	});
	assert.equal(unlock.status, 200, 'the share dialog can use the normal versioned unlock endpoint');
	assert.equal((await post({ url: 'https://example.com/shared', bookmarkTitle: 'Shared bookmark' })).status, 200);
	assert.equal((await postFiles([photo, attachment], 'share-file-regression')).status, 200);
	assert.equal((await postFiles([photo, attachment], 'share-file-regression')).status, 200, 'file retries should remain idempotent');
	assert.equal((await post({ text: 'First line\n\nLast line <literal>' })).status, 200, 'plain text can be added to an existing destination');
	const read = (await client.callTool({ name: 'read_page', arguments: { id: page.id } })).structuredContent.result;
	assert.equal(read.page.isLocked, 0, 'explicitly unlocking in the picker leaves the page unlocked');
	assert.deepEqual(read.document.content[0], original, 'sharing must preserve existing nodes and formatting');
	assert.deepEqual(read.document.content[1], { type: 'linkBookmark', attrs: { url: 'https://example.com/shared', title: 'Shared bookmark' } });
	assert.equal(read.document.content[2].type, 'image');
	assert.equal(read.document.content[3].type, 'fileAttachment');
	assert.deepEqual(read.document.content.slice(4), [
		{ type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
		{ type: 'paragraph' },
		{ type: 'paragraph', content: [{ type: 'text', text: 'Last line <literal>' }] }
	]);
	for (const node of read.document.content.slice(2, 4)) {
		const asset = await fetch(`${baseUrl}/assets/${node.attrs.assetId}`, { headers: { Cookie: sessionCookie } });
		assert.equal(asset.status, 200, 'shared photos and attachments must be stored as reachable assets');
		await asset.arrayBuffer();
	}
	const childRead = (await client.callTool({ name: 'read_page', arguments: { id: childPage.structuredContent.result.page.id } })).structuredContent.result;
	assert.equal(childRead.page.isLocked, 1, 'unlocking a parent must not unlock its children');
	assert.equal((await post({ text: '' })).status, 400, 'empty text shares must be rejected');
	assert.equal((await post({ url: 'javascript:alert(1)', text: 'unsafe' })).status, 400);
	const trashed = await client.callTool({ name: 'trash_page', arguments: { id: page.id, expectedVersion: read.page.version } });
	assert.equal(trashed.isError, undefined);
	assert.equal((await post({ text: 'Must not reach Trash' })).status, 404);
	console.log('Share regressions passed: locked destinations require explicit unlock, nested locks stay independent, links/photos/files/text preserve content, file retries do not duplicate, and Trash is excluded.');
}

try {
	let ready = false;
	let readinessDetail = 'server did not respond';
	for (let attempt = 0; attempt < 100; attempt++) {
		if (child.exitCode !== null) throw new Error(`Aporia exited before startup:\n${childOutput}`);
		try {
			const response = await fetch(`${baseUrl}/setup`, { redirect: 'manual' });
			if (response.status === 200) { ready = true; break; }
			readinessDetail = `GET /setup returned ${response.status}${response.headers.get('location') ? ` redirect=${response.headers.get('location')}` : ''}`;
		} catch (error) { readinessDetail = error instanceof Error ? error.message : String(error); }
		await delay(200);
	}
	assert.equal(ready, true, `Built server did not reach first-run setup (${readinessDetail}):\n${childOutput}`);
	const setup = await fetch(`${baseUrl}/setup`, {
		method: 'POST', redirect: 'manual',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: baseUrl, Referer: `${baseUrl}/setup` },
		body: new URLSearchParams({ username: 'mcp-test', password: 'integration-password-123', confirmation: 'integration-password-123' })
	});
	assert.equal(setup.status, 200, `test workspace should finish first-run setup: ${await setup.text()}`);
	const sessionCookie = setup.headers.get('set-cookie')?.split(';', 1)[0];
	assert.ok(sessionCookie, 'first-run setup should create a private browser session');

	assert.equal((await fetch(`${baseUrl}/mcp`)).status, 401, 'missing bearer token should fail');
	assert.equal((await fetch(`${baseUrl}/mcp`, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://attacker.test' } })).status, 403, 'unlisted browser Origin should fail');

	const client = await connect('aporia-integration-test');
	const tools = await client.listTools();
	assert.deepEqual(new Set(tools.tools.map((tool) => tool.name)), new Set([
		'list_pages', 'search_pages', 'read_page', 'create_page', 'update_page', 'move_page', 'trash_page', 'restore_page',
		'set_page_lock', 'set_page_layout', 'append_page_content'
	]));
	const clientTwo = await connect('aporia-parallel-test');
	const [listOne, listTwo] = await Promise.all([
		client.callTool({ name: 'list_pages', arguments: { limit: 10 } }),
		clientTwo.callTool({ name: 'list_pages', arguments: { limit: 10 } })
	]);
	assert.equal(listOne.isError, undefined);
	assert.equal(listTwo.isError, undefined);
	await verifyPageControls(client, clientTwo, sessionCookie);
	await verifyShareTargets(client, sessionCookie);

	const operationId = 'integration-create-0001';
	const initialContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Created through MCP' }] }] };
	const args = { operationId, title: 'MCP integration page', content: initialContent };
	const created = await client.callTool({ name: 'create_page', arguments: args });
	assert.equal(created.isError, undefined, JSON.stringify(created));
	const createResult = created.structuredContent.result;
	const pageId = createResult.page.id;
	assert.equal('contentJson' in createResult.page, false, 'create should not echo the full document JSON');
	assert.equal('contentText' in createResult.page, false, 'create should not echo extracted page text');
	const pageList = await client.callTool({ name: 'list_pages', arguments: { limit: 10 } });
	const listedPage = pageList.structuredContent.result.pages.find((page) => page.id === pageId);
	assert.ok(listedPage, 'the new page should appear in the page list');
	assert.equal('contentJson' in listedPage, false, 'page listing should not send full document JSON');
	assert.equal('contentText' in listedPage, false, 'page listing should not send full extracted page text');
	const repeated = await client.callTool({ name: 'create_page', arguments: args });
	assert.equal(repeated.structuredContent.result.page.id, pageId, 'repeating a create ID should return the same page');
	assert.equal('contentJson' in repeated.structuredContent.result.page, false, 'retried create should return a summary');
	const parent = await client.callTool({ name: 'create_page', arguments: {
		operationId: 'integration-parent-001', title: 'MCP move destination'
	} });
	const childPage = await client.callTool({ name: 'create_page', arguments: {
		operationId: 'integration-child-001', title: 'MCP move child', parentId: parent.structuredContent.result.page.id
	} });
	const search = await client.callTool({ name: 'search_pages', arguments: { query: 'MCP move child' } });
	assert.ok(search.structuredContent.result.pages.some((page) => page.id === childPage.structuredContent.result.page.id), 'search should find a page by title');
	assert.equal('contentJson' in search.structuredContent.result.pages[0], false, 'search should return summaries only');
	const moved = await client.callTool({ name: 'move_page', arguments: {
		id: childPage.structuredContent.result.page.id,
		expectedVersion: childPage.structuredContent.result.page.version,
		parentId: null,
		position: 0
	} });
	assert.equal(moved.structuredContent.result.page.parentId, null, 'move should move a page to the root');
	assert.equal('contentJson' in moved.structuredContent.result.page, false, 'move should return a summary');
	const movedBack = await client.callTool({ name: 'move_page', arguments: {
		id: moved.structuredContent.result.page.id,
		expectedVersion: moved.structuredContent.result.page.version,
		parentId: parent.structuredContent.result.page.id
	} });
	const parentNow = await client.callTool({ name: 'read_page', arguments: { id: parent.structuredContent.result.page.id } });
	const cycle = await client.callTool({ name: 'move_page', arguments: {
		id: parent.structuredContent.result.page.id,
		expectedVersion: parentNow.structuredContent.result.page.version,
		parentId: movedBack.structuredContent.result.page.id
	} });
	assert.equal(cycle.isError, true, 'move should reject cycles');
	assert.match(cycle.content[0].text, /INVALID_INPUT/);
	const backupResponse = await fetch(`${baseUrl}/api/backup/export`, { headers: { Cookie: sessionCookie } });
	assert.equal(backupResponse.status, 200, 'the authenticated workspace backup should export');
	const backup = new File([await backupResponse.arrayBuffer()], 'workspace.aporia.zip', { type: 'application/zip' });

	const read = await client.callTool({ name: 'read_page', arguments: { id: pageId } });
	assert.equal(read.isError, undefined, JSON.stringify(read));
	assert.equal(read.structuredContent.result.document.content[0].content[0].text, 'Created through MCP');
	assert.equal('contentJson' in read.structuredContent.result.page, false, 'read metadata should not duplicate the structured document');
	assert.equal('contentText' in read.structuredContent.result.page, false, 'read metadata should not duplicate readable text');
	const updatedContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated through MCP' }] }] };
	const updated = await client.callTool({ name: 'update_page', arguments: { id: pageId, expectedVersion: read.structuredContent.result.page.version, content: updatedContent } });
	assert.equal(updated.isError, undefined, JSON.stringify(updated));
	assert.equal('contentJson' in updated.structuredContent.result.page, false, 'update should not echo the full document JSON');
	const browserConflict = await fetch(`${baseUrl}/api/pages/${pageId}`, {
		method: 'POST',
		headers: { Cookie: sessionCookie, 'Content-Type': 'application/json' },
		body: JSON.stringify({ contentJson: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }), expectedVersion: read.structuredContent.result.page.version })
	});
	assert.equal(browserConflict.status, 409, `a stale browser save should conflict with an assistant edit: ${await browserConflict.text()}`);
	const conflict = await client.callTool({ name: 'update_page', arguments: { id: pageId, expectedVersion: read.structuredContent.result.page.version, title: 'stale edit' } });
	assert.equal(conflict.isError, true, 'a stale edit should be a tool error');
	assert.match(conflict.content[0].text, /CONFLICT/);

	const restoreForm = new FormData();
	restoreForm.append('file', backup);
	const backupRestore = await fetch(`${baseUrl}/api/backup/restore`, {
		method: 'POST', headers: { Cookie: sessionCookie, Origin: baseUrl, Referer: `${baseUrl}/` }, body: restoreForm
	});
	assert.equal(backupRestore.status, 200, `workspace backup restore should succeed: ${await backupRestore.text()}`);
	const staleAfterRestore = await client.callTool({ name: 'update_page', arguments: {
		id: pageId, expectedVersion: read.structuredContent.result.page.version, title: 'must conflict after restore'
	} });
	assert.equal(staleAfterRestore.isError, true, 'restore should invalidate previous workspace versions');
	assert.match(staleAfterRestore.content[0].text, /CONFLICT/);
	const staleLockAfterRestore = await client.callTool({ name: 'set_page_lock', arguments: {
		id: pageId, expectedVersion: read.structuredContent.result.page.version, isLocked: true
	} });
	assert.equal(staleLockAfterRestore.isError, true);
	assert.equal(staleLockAfterRestore.structuredContent.result.error.code, 'CONFLICT');

	const latest = await client.callTool({ name: 'read_page', arguments: { id: pageId } });
	const trashed = await client.callTool({ name: 'trash_page', arguments: { id: pageId, expectedVersion: latest.structuredContent.result.page.version } });
	assert.deepEqual(trashed.structuredContent.result.affectedPageIds, [pageId]);
	assert.equal('contentJson' in trashed.structuredContent.result.page, false, 'trash should return a summary');
	const restored = await client.callTool({ name: 'restore_page', arguments: { id: pageId, expectedVersion: trashed.structuredContent.result.page.version } });
	assert.equal(restored.structuredContent.result.page.isInTrash, 0);
	assert.equal('contentJson' in restored.structuredContent.result.page, false, 'restore should return a summary');
	const reviewFailures = [];
	const verify = (condition, message) => { if (!condition) reviewFailures.push(message); };
	const roots = await client.callTool({ name: 'list_pages', arguments: { parentId: null, limit: 100 } });
	verify(roots.structuredContent.result.pages.some((page) => page.id === pageId), 'parentId:null must list root pages');
	verify(roots.structuredContent.result.pages.every((page) => page.parentId === null), 'root listing must exclude child pages');
	const punctuationPage = await client.callTool({ name: 'create_page', arguments: {
		operationId: 'review-punctuation-page', title: 'C++ to-do "quoted" OR guide'
	} });
	for (const query of ['C++', 'to-do', '"quoted"', 'OR']) {
		const mcpSearch = await client.callTool({ name: 'search_pages', arguments: { query } });
		verify(!mcpSearch.isError && mcpSearch.structuredContent.result.pages.some((page) =>
			page.id === punctuationPage.structuredContent.result.page.id), `MCP search must treat ${query} as plain text`);
		const browserSearch = await fetch(`${baseUrl}/api/search?q=${encodeURIComponent(query)}`, { headers: { Cookie: sessionCookie } });
		verify((await browserSearch.json()).results.some((page) => page.id === punctuationPage.structuredContent.result.page.id),
			`browser search must treat ${query} as plain text`);
	}
	const orderParent = (await client.callTool({ name: 'create_page', arguments: {
		operationId: 'review-order-parent', title: 'Review order parent'
	} })).structuredContent.result.page;
	const orderA = (await client.callTool({ name: 'create_page', arguments: {
		operationId: 'review-order-child-a', title: 'Order A', parentId: orderParent.id
	} })).structuredContent.result.page;
	const orderB = (await client.callTool({ name: 'create_page', arguments: {
		operationId: 'review-order-child-b', title: 'Order B', parentId: orderParent.id
	} })).structuredContent.result.page;
	const grandchild = (await client.callTool({ name: 'create_page', arguments: {
		operationId: 'review-order-grandchild', title: 'Grandchild', parentId: orderA.id
	} })).structuredContent.result.page;
	await client.callTool({ name: 'move_page', arguments: { id: orderB.id, expectedVersion: orderB.version, parentId: orderParent.id, position: 0 } });
	const trashedParent = (await client.callTool({ name: 'trash_page', arguments: {
		id: orderParent.id, expectedVersion: orderParent.version
	} })).structuredContent.result.page;
	await client.callTool({ name: 'restore_page', arguments: { id: orderParent.id, expectedVersion: trashedParent.version } });
	const childrenAfterRestore = (await client.callTool({ name: 'list_pages', arguments: { parentId: orderParent.id } })).structuredContent.result.pages;
	verify(JSON.stringify(childrenAfterRestore.map((page) => [page.id, page.position])) === JSON.stringify([[orderB.id, 0], [orderA.id, 1]]),
		'Trash restore must preserve the manual order and positions of siblings');
	const nestedAfterRestore = (await client.callTool({ name: 'read_page', arguments: { id: grandchild.id } })).structuredContent.result.page;
	verify(nestedAfterRestore.position === 0, 'Trash restore must preserve nested sibling positions');
	const debugResponse = await fetch(`${baseUrl}/api/test-db`, { headers: { Cookie: sessionCookie } });
	verify(debugResponse.status === 404, 'the mutating database debug GET must be removed');
	assert.deepEqual(reviewFailures, [], reviewFailures.join('\n'));
	console.log('MCP integration passed: protected HTTP, two clients, all eleven tools, lock/unlock and browser races, icon/color/layout controls, preserving appended content, summary-sized results, moves/cycle rejection, idempotent create, browser/MCP conflicts, backup invalidation, Trash and restore.');
	console.log('Review regressions passed: root filtering, literal search punctuation, nested Trash ordering, and removed debug route.');
} catch (error) {
	console.error(error);
	console.error(childOutput);
	process.exitCode = 1;
} finally {
	for (const { client } of clients) await client.close().catch(() => {});
	child.kill();
	await Promise.race([once(child, 'exit'), delay(1000)]);
	await rm(directory, { recursive: true, force: true });
}
