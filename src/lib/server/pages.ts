import { db } from './database';
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
	isInTrash: number;
	createdAt: string;
	updatedAt: string;
	trashAt: string | null;
}

// Get all pages that are NOT in the trash
export async function getActivePages(): Promise<PageNode[]> {
	return db.select()
		.from(pages)
		.where(eq(pages.isInTrash, 0))
		.orderBy(pages.parentId, pages.position);
}

// Get all pages currently in the trash
export async function getTrashPages(): Promise<PageNode[]> {
	return db.select()
		.from(pages)
		.where(eq(pages.isInTrash, 1))
		.orderBy(pages.trashAt);
}

// Get a single page by ID
export async function getPageById(id: number): Promise<PageNode | null> {
	const result = await db.select().from(pages).where(eq(pages.id, id)).limit(1);
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
		icon: emoji,
		createdAt: now,
		updatedAt: now,
		contentJson: '{"type":"doc","content":[]}',
		contentText: '',
		schemaVersion: 1,
		revision: 1,
		isInTrash: 0
	}).returning();

	return result[0];
}

// Update page attributes (metadata, content, etc.)
export async function updatePage(
	id: number, 
	updates: Partial<Pick<PageNode, 'title' | 'icon' | 'contentJson' | 'contentText'>>
): Promise<PageNode | null> {
	const now = new Date().toISOString();
	const page = await getPageById(id);
	if (!page) return null;

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
		.returning();

	return result[0] || null;
}

// Move a page to a new parent and position
export async function movePage(id: number, targetParentId: number | null, targetPosition: number): Promise<boolean> {
	const now = new Date().toISOString();
	const pageToMove = await getPageById(id);
	if (!pageToMove) return false;

	const currentParentId = pageToMove.parentId;
	const currentPosition = pageToMove.position;

	// If parent is unchanged and targetPosition is same, nothing to do
	if (currentParentId === targetParentId && currentPosition === targetPosition) {
		return true;
	}

	// We wrap shifting and updating inside a synchronous transaction (no await/async)
	db.transaction((tx) => {
		// 1. Shift positions in old sibling list to fill the gap
		if (currentParentId === null) {
			tx.update(pages)
				.set({ position: sql`${pages.position} - 1`, updatedAt: now })
				.where(and(
					isNull(pages.parentId),
					eq(pages.isInTrash, 0),
					sql`${pages.position} > ${currentPosition}`
				))
				.run();
		} else {
			tx.update(pages)
				.set({ position: sql`${pages.position} - 1`, updatedAt: now })
				.where(and(
					eq(pages.parentId, currentParentId),
					eq(pages.isInTrash, 0),
					sql`${pages.position} > ${currentPosition}`
				))
				.run();
		}

		// 2. Shift positions in new sibling list to make room for the moved page
		if (targetParentId === null) {
			tx.update(pages)
				.set({ position: sql`${pages.position} + 1`, updatedAt: now })
				.where(and(
					isNull(pages.parentId),
					eq(pages.isInTrash, 0),
					sql`${pages.position} >= ${targetPosition}`
				))
				.run();
		} else {
			tx.update(pages)
				.set({ position: sql`${pages.position} + 1`, updatedAt: now })
				.where(and(
					eq(pages.parentId, targetParentId),
					eq(pages.isInTrash, 0),
					sql`${pages.position} >= ${targetPosition}`
				))
				.run();
		}

		// 3. Update the page to move with its new parent and position
		tx.update(pages)
			.set({
				parentId: targetParentId,
				position: targetPosition,
				updatedAt: now
			})
			.where(eq(pages.id, id))
			.run();
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
