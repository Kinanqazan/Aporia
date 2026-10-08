import { createHash, randomUUID } from 'node:crypto';
import { sqlite } from '$lib/server/database';
import { generateId, extractTextFromJson, type PageNode } from '$lib/server/pages';
import { normalizeIconColor } from '$lib/icon-colors';
import { getWorkspaceGeneration } from './versions.js';
import { parsePageVersion, pageVersion } from './page-version.js';

const PAGE_COLUMNS = `id, parent_id AS parentId, position, title, icon, icon_color AS iconColor,
	content_json AS contentJson, content_text AS contentText, schema_version AS schemaVersion,
	revision, is_locked AS isLocked, is_full_width AS isFullWidth, is_in_trash AS isInTrash,
	created_at AS createdAt, updated_at AS updatedAt, trash_at AS trashAt`;
const PAGE_SUMMARY_COLUMNS = `id, parent_id AS parentId, position, title, icon, icon_color AS iconColor,
	schema_version AS schemaVersion, revision, is_locked AS isLocked, is_full_width AS isFullWidth,
	is_in_trash AS isInTrash, created_at AS createdAt, updated_at AS updatedAt, trash_at AS trashAt`;

export class PageOperationError extends Error {
	constructor(public code: 'NOT_FOUND' | 'INVALID_INPUT' | 'LOCKED' | 'CONFLICT', message: string, public current?: unknown) {
		super(message);
	}
}

function hash(input: unknown): string {
	return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function row(id: string): PageNode | undefined {
	return sqlite.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE id = ?`).get(id) as PageNode | undefined;
}

export function publicPage(page: PageNode) {
	return { ...page, version: pageVersion(page.revision, getWorkspaceGeneration()) };
}

export function publicPageSummary(page: PageNode) {
	const { contentJson: _contentJson, contentText: _contentText, ...metadata } = page;
	return { ...metadata, version: pageVersion(page.revision, getWorkspaceGeneration()) };
}

function checkVersion(page: PageNode, expectedVersion: string): void {
	const parsed = parsePageVersion(expectedVersion);
	if (!parsed || parsed.generation !== getWorkspaceGeneration() || parsed.revision !== page.revision) {
		const { contentJson: _contentJson, contentText: _contentText, ...metadata } = page;
		throw new PageOperationError('CONFLICT', 'The page has changed. Read it again before editing.', { ...metadata, version: pageVersion(page.revision, getWorkspaceGeneration()) });
	}
}

function activePage(id: string): PageNode {
	const page = row(id);
	if (!page || page.isInTrash) throw new PageOperationError('NOT_FOUND', 'Active page not found.');
	return page;
}

export function listPages(options: { parentId?: string | null; includeTrash?: boolean; limit: number; offset: number }) {
	const conditions: string[] = [];
	const values: unknown[] = [];
	if (options.includeTrash) conditions.push('is_in_trash = 1');
	else conditions.push('is_in_trash = 0');
	if (options.parentId !== undefined) { conditions.push('parent_id = ?'); values.push(options.parentId); }
	const where = conditions.join(' AND ');
	const total = (sqlite.prepare(`SELECT count(*) AS n FROM pages WHERE ${where}`).get(...values) as { n: number }).n;
	const pages = sqlite.prepare(`SELECT ${PAGE_SUMMARY_COLUMNS} FROM pages WHERE ${where} ORDER BY parent_id, position LIMIT ? OFFSET ?`)
		.all(...values, options.limit, options.offset) as Array<Omit<PageNode, 'contentJson' | 'contentText'>>;
	return {
		pages: pages.map((page) => ({ ...page, version: pageVersion(page.revision, getWorkspaceGeneration()) })),
		total,
		limit: options.limit,
		offset: options.offset,
		hasMore: options.offset + pages.length < total
	};
}

export function getMcpPage(id: string) {
	const page = row(id);
	if (!page) throw new PageOperationError('NOT_FOUND', 'Page not found.');
	if (Buffer.byteLength(page.contentJson, 'utf8') > 2_000_000) throw new PageOperationError('INVALID_INPUT', 'Page content exceeds the 2 MB read limit.');
	return publicPage(page);
}

export function searchMcpPages(query: string, limit: number) {
	const words = query.trim().split(/\s+/).filter(Boolean).map(term => `${term.replace(/"/g, '""')}*`);
	if (!words.length) return { pages: [], limit, truncated: false };
	try {
		const found = sqlite.prepare(`SELECT p.id, p.title, p.icon, p.icon_color AS iconColor, p.parent_id AS parentId, p.position, p.revision
			FROM pages_fts JOIN pages p ON p.id = pages_fts.id
			WHERE pages_fts MATCH ? AND p.is_in_trash = 0 ORDER BY rank LIMIT ?`).all(words.join(' AND '), limit + 1) as any[];
		const truncated = found.length > limit;
		return { pages: found.slice(0, limit).map(p => ({ ...p, version: pageVersion(p.revision, getWorkspaceGeneration()) })), limit, truncated };
	} catch {
		throw new PageOperationError('INVALID_INPUT', 'Search syntax is not valid. Use plain words.');
	}
}

export function createPageIdempotently(input: { operationId: string; title: string; parentId: string | null; contentJson: string }) {
	if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.operationId)) throw new PageOperationError('INVALID_INPUT', 'operationId must be 8–128 letters, numbers, dots, underscores, colons, or dashes.');
	const now = new Date().toISOString();
	const payload = { title: input.title, parentId: input.parentId, contentJson: input.contentJson };
	const inputHash = hash(payload);
	const existing = sqlite.prepare('SELECT input_hash, page_id FROM mcp_requests WHERE operation_id = ?').get(input.operationId) as { input_hash: string; page_id: string } | undefined;
	if (existing) {
		if (existing.input_hash !== inputHash) throw new PageOperationError('INVALID_INPUT', 'operationId was already used with different page contents.');
		const page = row(existing.page_id);
		return { page: page ? publicPageSummary(page) : null, repeated: true, currentStatus: page ? (page.isInTrash ? 'trashed' : 'active') : 'deleted' };
	}
	if (input.parentId) activePage(input.parentId);
	const result = sqlite.transaction(() => {
		const siblings = sqlite.prepare('SELECT count(*) AS n FROM pages WHERE parent_id IS ? AND is_in_trash = 0').get(input.parentId) as { n: number };
		const id = generateId();
		sqlite.prepare(`INSERT INTO pages (id, parent_id, position, title, icon, icon_color, content_json, content_text, schema_version, revision, is_locked, is_full_width, is_in_trash, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 0, 0, ?, ?)`)
			.run(id, input.parentId, siblings.n, input.title, 'lucide:file-text', normalizeIconColor(null), input.contentJson, extractTextFromJson(input.contentJson), now, now);
		sqlite.prepare('INSERT INTO mcp_requests (operation_id, input_hash, page_id, created_at) VALUES (?, ?, ?, ?)')
			.run(input.operationId, inputHash, id, now);
		return id;
	})();
	return { page: publicPageSummary(row(result)!), repeated: false, currentStatus: 'active' };
}

export function updateMcpPage(input: { id: string; expectedVersion: string; title?: string; contentJson?: string }) {
	if (input.title === undefined && input.contentJson === undefined) throw new PageOperationError('INVALID_INPUT', 'Provide a title or contentJson to update.');
	const page = activePage(input.id);
	checkVersion(page, input.expectedVersion);
	if (page.isLocked) throw new PageOperationError('LOCKED', 'Unlock this page in Aporia before editing it.');
	const contentJson = input.contentJson ?? page.contentJson;
	const title = input.title ?? page.title;
	const changed = title !== page.title || contentJson !== page.contentJson;
	if (!changed) return { page: publicPageSummary(page), changed: false };
	const now = new Date().toISOString();
	const result = sqlite.prepare(`UPDATE pages SET title = ?, content_json = ?, content_text = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? AND is_in_trash = 0 AND is_locked = 0`)
		.run(title, contentJson, extractTextFromJson(contentJson), now, page.id, page.revision);
	if (!result.changes) throw new PageOperationError('CONFLICT', 'The page changed while saving. Read it again.', row(input.id) ? publicPageSummary(row(input.id)!) : undefined);
	return { page: publicPageSummary(row(input.id)!), changed: true };
}

export function moveMcpPage(input: { id: string; expectedVersion: string; parentId: string | null; position?: number }) {
	const page = activePage(input.id);
	checkVersion(page, input.expectedVersion);
	if (page.isLocked) throw new PageOperationError('LOCKED', 'Unlock this page in Aporia before organizing it.');
	if (input.parentId === page.id) throw new PageOperationError('INVALID_INPUT', 'A page cannot be its own parent.');
	const target = input.parentId ? activePage(input.parentId) : null;
	let ancestor = target;
	while (ancestor) {
		if (ancestor.id === page.id) throw new PageOperationError('INVALID_INPUT', 'A page cannot be moved under one of its descendants.');
		ancestor = ancestor.parentId ? row(ancestor.parentId) ?? null : null;
	}
	const siblings = sqlite.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE parent_id IS ? AND is_in_trash = 0 AND id <> ? ORDER BY position`).all(input.parentId, page.id) as PageNode[];
	const position = Math.max(0, Math.min(input.position ?? siblings.length, siblings.length));
	if (page.parentId === input.parentId && page.position === position) return { page: publicPageSummary(page), changed: false };
	const ordered = [...siblings]; ordered.splice(position, 0, page);
	const now = new Date().toISOString();
	sqlite.transaction(() => {
		for (const [index, item] of ordered.entries()) {
			const nextParentId = item.id === page.id ? input.parentId : item.parentId;
			if (item.parentId !== nextParentId || item.position !== index || item.id === page.id) {
				sqlite.prepare('UPDATE pages SET parent_id = ?, position = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(nextParentId, index, now, item.id);
			}
		}
		if (page.parentId !== input.parentId) {
			const oldSiblings = sqlite.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE parent_id IS ? AND is_in_trash = 0 AND id <> ? ORDER BY position`).all(page.parentId, page.id) as PageNode[];
			for (const [index, sibling] of oldSiblings.entries()) if (sibling.position !== index) sqlite.prepare('UPDATE pages SET position = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(index, now, sibling.id);
		}
	})();
	return { page: publicPageSummary(row(page.id)!), changed: true };
}

function descendants(rootId: string): PageNode[] {
	const result: PageNode[] = [];
	const visit = (parentId: string) => {
		const children = sqlite.prepare(`SELECT ${PAGE_COLUMNS} FROM pages WHERE parent_id = ?`).all(parentId) as PageNode[];
		for (const child of children) { result.push(child); visit(child.id); }
	};
	visit(rootId);
	return result;
}

export function trashMcpPage(input: { id: string; expectedVersion: string }) {
	const page = row(input.id);
	if (!page) throw new PageOperationError('NOT_FOUND', 'Page not found.');
	checkVersion(page, input.expectedVersion);
	if (page.isInTrash) return { page: publicPageSummary(page), affectedPageIds: [], unchanged: true };
	if (page.isLocked) throw new PageOperationError('LOCKED', 'Unlock this page before moving it to Trash.');
	const affected = [page, ...descendants(page.id)]; const now = new Date().toISOString();
	sqlite.transaction(() => { for (const item of affected) sqlite.prepare('UPDATE pages SET is_in_trash = 1, trash_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?').run(now, now, item.id); })();
	return { page: publicPageSummary(row(page.id)!), affectedPageIds: affected.map(p => p.id), unchanged: false };
}

export function restoreMcpPage(input: { id: string; expectedVersion: string; parentId?: string | null }) {
	const page = row(input.id);
	if (!page) throw new PageOperationError('NOT_FOUND', 'Page not found.');
	checkVersion(page, input.expectedVersion);
	if (!page.isInTrash) return { page: publicPageSummary(page), affectedPageIds: [], unchanged: true };
	let parentId = input.parentId === undefined ? (page.parentId && !row(page.parentId)?.isInTrash ? page.parentId : null) : input.parentId;
	if (parentId) activePage(parentId);
	const affected = [page, ...descendants(page.id).filter(p => p.isInTrash)];
	const siblings = sqlite.prepare('SELECT count(*) AS n FROM pages WHERE parent_id IS ? AND is_in_trash = 0').get(parentId) as { n: number };
	const now = new Date().toISOString();
	sqlite.transaction(() => {
		sqlite.prepare('UPDATE pages SET parent_id = ?, position = ?, is_in_trash = 0, trash_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ?').run(parentId, siblings.n, now, page.id);
		let position = 0;
		for (const child of affected.slice(1)) sqlite.prepare('UPDATE pages SET position = ?, is_in_trash = 0, trash_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ?').run(position++, now, child.id);
	})();
	return { page: publicPageSummary(row(page.id)!), affectedPageIds: affected.map(p => p.id) };
}

export function invalidateWorkspaceGeneration(): void {
	sqlite.prepare("INSERT INTO settings (key, value) VALUES ('mcp_workspace_generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(randomUUID());
	sqlite.prepare('DELETE FROM mcp_requests').run();
}

export function pruneMcpReceipts(): void {
	const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
	sqlite.prepare('DELETE FROM mcp_requests WHERE created_at < ?').run(cutoff);
}
