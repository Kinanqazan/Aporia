import { db, sqlite } from './database';
import { pages } from './schema';
import { eq, and, isNull, sql } from 'drizzle-orm';

export interface PageNode {
	id: number;
	parentId: number | null;
	position: number;
	title: string;
	icon: string | null;
	contentJson: string;
	contentText: string;
	schemaVersion: number;
	revision: number;
	isLocked: number;
	isInTrash: number;
	createdAt: string;
	updatedAt: string;
	trashAt: string | null;
}

export interface SearchResult {
	id: number;
	title: string;
	icon: string | null;
	parentId: number | null;
	/** HTML escaped; only generated <b> tags are preserved for match highlighting. */
	snippet: string;
}

// Get all pages that are NOT in the trash
export async function getActivePages(): Promise<PageNode[]> {
	return await db.select()
		.from(pages)
		.where(eq(pages.isInTrash, 0))
		.orderBy(pages.parentId, pages.position) as PageNode[];
}

// Get all pages currently in the trash
export async function getTrashPages(): Promise<PageNode[]> {
	return await db.select()
		.from(pages)
		.where(eq(pages.isInTrash, 1))
		.orderBy(pages.trashAt) as PageNode[];
}

// Get a single page by ID
export async function getPageById(id: number): Promise<PageNode | null> {
	const result = await db.select().from(pages).where(eq(pages.id, id)).limit(1) as PageNode[];
	return result.length > 0 ? result[0] : null;
}

// Create a new page
export async function createPage(parentId: number | null = null, title: string = 'Untitled', emoji: string | null = null): Promise<PageNode> {
	const now = new Date().toISOString();
	
	// Determine the next position among siblings
	let nextPosition = 0;
	if (parentId === null) {
		const siblings = await db.select({ count: sql<number>`count(*)` })
			.from(pages)
			.where(and(isNull(pages.parentId), eq(pages.isInTrash, 0)));
		nextPosition = siblings[0]?.count || 0;
	} else {
		const siblings = await db.select({ count: sql<number>`count(*)` })
			.from(pages)
			.where(and(eq(pages.parentId, parentId), eq(pages.isInTrash, 0)));
		nextPosition = siblings[0]?.count || 0;
	}

	const result = await db.insert(pages).values({
		parentId,
		position: nextPosition,
		title,
		icon: emoji || 'lucide:file-text',
		createdAt: now,
		updatedAt: now,
		contentJson: '{"type":"doc","content":[]}',
		contentText: '',
		schemaVersion: 1,
		revision: 1,
		isInTrash: 0
	}).returning() as PageNode[];

	return result[0];
}

// Update page attributes (metadata, content, etc.)
export async function updatePage(
	id: number, 
	updates: Partial<Pick<PageNode, 'title' | 'icon' | 'contentJson' | 'contentText' | 'isLocked'>>
): Promise<PageNode | null> {
	const now = new Date().toISOString();
	const page = await getPageById(id);
	if (!page) return null;

	if (updates.contentJson !== undefined) {
		updates.contentText = extractTextFromJson(updates.contentJson);
	}

	const newRevision = updates.contentJson && updates.contentJson !== page.contentJson 
		? page.revision + 1 
		: page.revision;

	const result = await db.update(pages)
		.set({
			...updates,
			revision: newRevision,
			updatedAt: now
		})
		.where(eq(pages.id, id))
		.returning() as PageNode[];

	return result[0] || null;
}

// Move a page to a new parent and position
export async function movePage(id: number, targetParentId: number | null, targetPosition: number): Promise<boolean> {
	const now = new Date().toISOString();
	const pageToMove = await getPageById(id);
	if (!pageToMove || pageToMove.isInTrash) return false;
	if (!Number.isInteger(targetPosition) || targetPosition < 0 || targetParentId === id) return false;

	const activePages = await getActivePages();
	const pagesById = new Map(activePages.map((page) => [page.id, page]));

	// A page cannot be moved beneath itself or one of its descendants.
	let ancestorId = targetParentId;
	while (ancestorId !== null) {
		if (ancestorId === id) return false;
		const ancestor = pagesById.get(ancestorId);
		if (!ancestor) return false;
		ancestorId = ancestor.parentId;
	}

	const oldSiblings = activePages
		.filter((page) => page.parentId === pageToMove.parentId && page.id !== id)
		.sort((a, b) => a.position - b.position);
	const newSiblings = activePages
		.filter((page) => page.parentId === targetParentId && page.id !== id)
		.sort((a, b) => a.position - b.position);
	const finalPosition = Math.min(targetPosition, newSiblings.length);

	// Re-number both affected sibling lists. This also handles reordering within the
	// same parent without leaving gaps or duplicating positions.
	db.transaction((tx) => {
		for (const [position, sibling] of oldSiblings.entries()) {
			tx.update(pages)
				.set({ position, updatedAt: now })
				.where(eq(pages.id, sibling.id))
				.run();
		}

		const reorderedSiblings = [...newSiblings];
		reorderedSiblings.splice(finalPosition, 0, pageToMove);
		for (const [position, sibling] of reorderedSiblings.entries()) {
			tx.update(pages)
				.set({
					parentId: sibling.id === id ? targetParentId : sibling.parentId,
					position,
					updatedAt: now
				})
				.where(eq(pages.id, sibling.id))
				.run();
		}
	});

	return true;
}

// Send a page (and recursively all its children) to the Trash Bin
export async function sendToTrash(id: number): Promise<boolean> {
	const now = new Date().toISOString();
	const page = await getPageById(id);
	if (!page) return false;

	db.transaction((tx) => {
		// Set trash state on the page itself
		tx.update(pages)
			.set({
				isInTrash: 1,
				trashAt: now,
				updatedAt: now
			})
			.where(eq(pages.id, id))
			.run();

		// Recursively flag children (they follow parent to trash)
		const findAndTrashChildren = (parentId: number) => {
			const children = tx.select().from(pages).where(eq(pages.parentId, parentId)).all();
			for (const child of children) {
				tx.update(pages)
					.set({
						isInTrash: 1,
						trashAt: now,
						updatedAt: now
					})
					.where(eq(pages.id, child.id))
					.run();
				findAndTrashChildren(child.id);
			}
		};

		findAndTrashChildren(id);
	});

	return true;
}

// Restore a page from the Trash Bin
export async function restoreFromTrash(id: number, newParentId: number | null = null): Promise<boolean> {
	const now = new Date().toISOString();
	const page = await getPageById(id);
	if (!page) return false;

	// Check if current parent is in trash. If so, default parent becomes root (null) unless parent is specified.
	let parentId = newParentId;
	if (parentId === null && page.parentId !== null) {
		const parent = db.select().from(pages).where(eq(pages.id, page.parentId)).limit(1).all()[0];
		if (parent && parent.isInTrash === 0) {
			parentId = page.parentId;
		}
	}

	// Calculate sibling position in restored location
	let nextPosition = 0;
	if (parentId === null) {
		const siblings = db.select({ count: sql<number>`count(*)` })
			.from(pages)
			.where(and(isNull(pages.parentId), eq(pages.isInTrash, 0)))
			.all();
		nextPosition = siblings[0]?.count || 0;
	} else {
		const siblings = db.select({ count: sql<number>`count(*)` })
			.from(pages)
			.where(and(eq(pages.parentId, parentId), eq(pages.isInTrash, 0)))
			.all();
		nextPosition = siblings[0]?.count || 0;
	}

	db.transaction((tx) => {
		// Restore the target page
		tx.update(pages)
			.set({
				parentId,
				position: nextPosition,
				isInTrash: 0,
				trashAt: null,
				updatedAt: now
			})
			.where(eq(pages.id, id))
			.run();

		// Recursively restore direct children to keep tree structure intact
		const restoreChildren = (pId: number) => {
			const children = tx.select().from(pages).where(and(eq(pages.parentId, pId), eq(pages.isInTrash, 1))).all();
			let childPos = 0;
			for (const child of children) {
				tx.update(pages)
					.set({
						isInTrash: 0,
						trashAt: null,
						position: childPos++,
						updatedAt: now
					})
					.where(eq(pages.id, child.id))
					.run();
				restoreChildren(child.id);
			}
		};

		restoreChildren(id);
	});

	return true;
}

// Permanently delete a page and all its descendants
export async function deletePermanently(id: number): Promise<boolean> {
	const page = await getPageById(id);
	if (!page) return false;

	// Drizzle will handle onDelete cascade automatically since we specified cascade on parent_id reference!
	await db.delete(pages).where(eq(pages.id, id));
	return true;
}

// Empty the trash completely
export async function emptyTrash(): Promise<void> {
	await db.delete(pages).where(eq(pages.isInTrash, 1));
}

// Search pages using FTS5 virtual table
export function searchPages(query: string): SearchResult[] {
	if (!query) return [];
	const terms = query.trim().split(/\s+/).filter(Boolean).map(term => `${term.replace(/"/g, '""')}*`);
	if (terms.length === 0) return [];
	const ftsQuery = terms.join(' AND ');

	try {
		const results = sqlite.prepare(`
			SELECT p.id, p.title, p.icon, p.parent_id as parentId,
			       snippet(pages_fts, -1, '\u0001', '\u0002', '...', 16) as snippet
			FROM pages_fts fts
			JOIN pages p ON p.id = fts.id
			WHERE pages_fts MATCH ? AND p.is_in_trash = 0
			LIMIT 25
		`).all(ftsQuery) as any[];

		return results.map(row => ({
			id: Number(row.id),
			title: String(row.title),
			icon: row.icon ? String(row.icon) : null,
			parentId: row.parentId ? Number(row.parentId) : null,
			snippet: row.snippet ? toSafeHighlightedSnippet(String(row.snippet)) : ''
		}));
	} catch (err) {
		console.error('FTS5 search error:', err);
		return [];
	}
}

function toSafeHighlightedSnippet(snippet: string): string {
	return snippet
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/\u0001/g, '<b>')
		.replace(/\u0002/g, '</b>');
}

// Helper to extract text from Tiptap JSON string
export function extractTextFromJson(jsonStr: string): string {
	try {
		const doc = JSON.parse(jsonStr);
		return walkNode(doc).trim();
	} catch {
		return '';
	}
}

function walkNode(node: any): string {
	if (!node) return '';
	let text = '';
	if (node.type === 'text' && typeof node.text === 'string') {
		text += node.text;
	}
	if (Array.isArray(node.content)) {
		text += ' ' + node.content.map(walkNode).join(' ');
	}
	return text;
}
