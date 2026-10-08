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
		'list_pages', 'search_pages', 'read_page', 'create_page', 'update_page', 'move_page', 'trash_page', 'restore_page'
	]));
	const clientTwo = await connect('aporia-parallel-test');
	const [listOne, listTwo] = await Promise.all([
		client.callTool({ name: 'list_pages', arguments: { limit: 10 } }),
		clientTwo.callTool({ name: 'list_pages', arguments: { limit: 10 } })
	]);
	assert.equal(listOne.isError, undefined);
	assert.equal(listTwo.isError, undefined);

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

	const latest = await client.callTool({ name: 'read_page', arguments: { id: pageId } });
	const trashed = await client.callTool({ name: 'trash_page', arguments: { id: pageId, expectedVersion: latest.structuredContent.result.page.version } });
	assert.deepEqual(trashed.structuredContent.result.affectedPageIds, [pageId]);
	assert.equal('contentJson' in trashed.structuredContent.result.page, false, 'trash should return a summary');
	const restored = await client.callTool({ name: 'restore_page', arguments: { id: pageId, expectedVersion: trashed.structuredContent.result.page.version } });
	assert.equal(restored.structuredContent.result.page.isInTrash, 0);
	assert.equal('contentJson' in restored.structuredContent.result.page, false, 'restore should return a summary');
	console.log('MCP integration passed: protected HTTP, two clients, all eight tools, summary-sized list/search/write results, page moves/cycle rejection, idempotent create, browser/MCP conflicts, backup invalidation, Trash and restore.');
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
