import { db, sqlite } from './database';
import { pages } from './schema';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { normalizeIconColor } from '$lib/icon-colors';
import { parsePageVersion } from './mcp/page-version.js';
import { getWorkspaceGeneration } from './mcp/versions.js';

export function generateId(length: number = 10): string {
	const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	const bytes = randomBytes(length);
	let result = '';
	for (let i = 0; i < length; i++) {
		result += chars[bytes[i] % chars.length];
	}
	return result;
}

export interface PageNode {
	id: string;
	parentId: string | null;
	position: number;
	title: string;
	icon: string | null;
	iconColor: string | null;
	contentJson: string;
	contentText: string;
	schemaVersion: number;
	revision: number;
	isLocked: number;
	isFullWidth: number;
	isInTrash: number;
	createdAt: string;
	updatedAt: string;
	trashAt: string | null;
}

export interface SearchResult {
	id: string;
	title: string;
	icon: string | null;
	iconColor: string | null;
	parentId: string | null;
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
export async function getPageById(id: string): Promise<PageNode | null> {
	const result = await db.select().from(pages).where(eq(pages.id, id)).limit(1) as PageNode[];
	return result.length > 0 ? result[0] : null;
}

// Create a new page
export async function createPage(
	parentId: string | null = null,
	title: string = 'Untitled',
	emoji: string | null = null,
	iconColor: string | null = null
): Promise<PageNode> {
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

	const newId = generateId();

	const result = await db.insert(pages).values({
		id: newId,
		parentId,
		position: nextPosition,
		title,
		icon: emoji || 'lucide:file-text',
		iconColor: normalizeIconColor(iconColor),
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
	id: string, 
	updates: Partial<Pick<PageNode, 'title' | 'icon' | 'iconColor' | 'contentJson' | 'contentText' | 'isLocked' | 'isFullWidth'>>
): Promise<PageNode | null> {
	const now = new Date().toISOString();
	const page = await getPageById(id);
	if (!page) return null;

	if (updates.contentJson !== undefined) {
		updates.contentText = extractTextFromJson(updates.contentJson);
	}
	if (updates.iconColor !== undefined) {
		updates.iconColor = normalizeIconColor(updates.iconColor);
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

export async function updatePageAtVersion(
	id: string,
	expectedVersion: string,
	updates: Partial<Pick<PageNode, 'title' | 'icon' | 'iconColor' | 'isLocked' | 'isFullWidth'>>
): Promise<PageNode | null> {
	const parsed = parsePageVersion(expectedVersion);
	if (!parsed || parsed.generation !== getWorkspaceGeneration()) return null;
	const current = await getPageById(id);
	if (!current || current.isInTrash || current.revision !== parsed.revision) return null;
	if (current.isLocked && updates.isLocked === undefined &&
		!Object.keys(updates).every((key) => key === 'isFullWidth')) return null;
	if (updates.iconColor !== undefined) updates.iconColor = normalizeIconColor(updates.iconColor);
	const changed = (Object.keys(updates) as Array<keyof typeof updates>).some((key) => updates[key] !== current[key]);
	const now = new Date().toISOString();
	const result = await db.update(pages)
		.set({
			...updates,
			revision: changed ? sql`${pages.revision} + 1` : pages.revision,
			updatedAt: changed ? now : current.updatedAt
		})
		.where(and(
			eq(pages.id, id), eq(pages.revision, parsed.revision), eq(pages.isInTrash, 0),
			sql`EXISTS (SELECT 1 FROM settings WHERE key = 'mcp_workspace_generation' AND value = ${parsed.generation})`
		))
		.returning() as PageNode[];
	return result[0] || null;
}

export async function updatePageContentAtVersion(
	id: string,
	contentJson: string,
	expectedVersion: string,
	expected: { isLocked: number; contentJson: string }
): Promise<PageNode | null> {
	const parsed = parsePageVersion(expectedVersion);
	if (!parsed || parsed.generation !== getWorkspaceGeneration()) return null;
	const now = new Date().toISOString();
	const contentText = extractTextFromJson(contentJson);
	const result = await db.update(pages)
		.set({
			contentJson,
			contentText,
			revision: sql`${pages.revision} + case when ${pages.contentJson} <> ${contentJson} then 1 else 0 end`,
			updatedAt: now
		})
		.where(and(
			eq(pages.id, id),
			eq(pages.revision, parsed.revision),
			eq(pages.isLocked, expected.isLocked),
			eq(pages.isInTrash, 0),
			eq(pages.contentJson, expected.contentJson),
			sql`EXISTS (SELECT 1 FROM settings WHERE key = 'mcp_workspace_generation' AND value = ${parsed.generation})`
		))
		.returning() as PageNode[];
	return result[0] || null;
}

// Permanently delete a page and all its descendants
export async function deletePermanently(id: string): Promise<boolean> {
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
export function toFtsPrefixQuery(query: string): string {
	return query.trim().split(/\s+/).filter(Boolean)
		.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' AND ');
}

export function searchPages(query: string): SearchResult[] {
	const ftsQuery = toFtsPrefixQuery(query);
	if (!ftsQuery) return [];

	try {
		const results = sqlite.prepare(`
			SELECT p.id, p.title, p.icon, p.icon_color as iconColor, p.parent_id as parentId,
			       snippet(pages_fts, -1, '\u0001', '\u0002', '...', 16) as snippet
			FROM pages_fts fts
			JOIN pages p ON p.id = fts.id
			WHERE pages_fts MATCH ? AND p.is_in_trash = 0
			LIMIT 25
		`).all(ftsQuery) as any[];

		return results.map(row => ({
			id: String(row.id),
			title: String(row.title),
			icon: row.icon ? String(row.icon) : null,
			iconColor: row.iconColor ? String(row.iconColor) : null,
			parentId: row.parentId ? String(row.parentId) : null,
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
	if (node.type === 'databaseBlock') {
		const columns = Array.isArray(node.attrs?.columns) ? node.attrs.columns : [];
		const rows = Array.isArray(node.attrs?.rows) ? node.attrs.rows : [];
		text += ' ' + columns.map((column: any) => String(column?.name || '')).join(' ');
		for (const row of rows) {
			text += ' ' + columns.map((column: any) => {
				const value = row?.[column?.id];
				return Array.isArray(value) ? value.join(' ') : value == null ? '' : String(value);
			}).join(' ');
		}
	}
	if (node.type === 'linkBookmark') {
		const title = typeof node.attrs?.title === 'string' ? node.attrs.title : '';
		const url = typeof node.attrs?.url === 'string' ? node.attrs.url : '';
		text += ` ${title} ${url}`;
	}
	if (node.type === 'fileAttachment' && typeof node.attrs?.fileName === 'string') {
		text += ` ${node.attrs.fileName}`;
	}
	if (Array.isArray(node.content)) {
		text += ' ' + node.content.map(walkNode).join(' ');
	}
	return text;
}

export async function seedDemoWorkspace(): Promise<PageNode[]> {
	const active = await getActivePages();
	if (active.length > 0) return active;

	// 1. Getting Started (Yellow icon)
	const page1 = await createPage(null, 'Getting Started', 'lucide:rocket', '#eab308');
	const content1 = {
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 1 },
				content: [{ type: 'text', text: 'Welcome to Aporia' }]
			},
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: 'Aporia is your '
					},
					{
						type: 'text',
						text: 'private, local-first workspace',
						marks: [
							{ type: 'textStyle', attrs: { color: 'var(--color-yellow)' } },
							{ type: 'bold' }
						]
					},
					{
						type: 'text',
						text: ' for notes, task checklists, and database views. Everything stays '
					},
					{
						type: 'text',
						text: 'fast, clean, and 100% under your control',
						marks: [
							{ type: 'highlight', attrs: { color: 'var(--bg-green)' } },
							{ type: 'textStyle', attrs: { color: 'var(--color-green)' } },
							{ type: 'bold' }
						]
					},
					{
						type: 'text',
						text: '.'
					}
				]
			},
			{
				type: 'details',
				attrs: { open: false, level: 2 },
				content: [
					{
						type: 'detailsSummary',
						content: [{ type: 'text', text: 'Quick Tips & Shortcuts (Click to expand)' }]
					},
					{
						type: 'detailsContent',
						content: [
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Press ' },
									{ type: 'text', text: '/', marks: [{ type: 'code' }] },
									{ type: 'text', text: ' anywhere on an empty line to insert headings, toggle headings, database tables, or checklists.' }
								]
							},
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Highlight text to customize it with ' },
									{
										type: 'text',
										text: 'rich colors',
										marks: [
											{ type: 'textStyle', attrs: { color: 'var(--color-purple)' } },
											{ type: 'bold' }
										]
									},
									{ type: 'text', text: ' and ' },
									{
										type: 'text',
										text: 'vibrant highlights',
										marks: [
											{ type: 'highlight', attrs: { color: 'var(--bg-yellow)' } },
											{ type: 'bold' }
										]
									},
									{ type: 'text', text: ' from the floating bubble menu.' }
								]
							},
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Use ' },
									{ type: 'text', text: 'Ctrl + K', marks: [{ type: 'code' }] },
									{ type: 'text', text: ' (or Cmd + K) to search across all pages instantly.' }
								]
							}
						]
					}
				]
			},
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'Quick Start Checklist' }]
			},
			{
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Type ' },
									{ type: 'text', text: '/', marks: [{ type: 'code' }] },
									{ type: 'text', text: ' anywhere in the editor to open the block command menu' }
								]
							}
						]
					},
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Explore the starter pages in the sidebar (' },
									{
										type: 'text',
										text: 'Shopping',
										marks: [{ type: 'textStyle', attrs: { color: 'var(--color-green)' } }, { type: 'bold' }]
									},
									{ type: 'text', text: ', ' },
									{
										type: 'text',
										text: 'Book Tracker',
										marks: [{ type: 'textStyle', attrs: { color: 'var(--color-blue)' } }, { type: 'bold' }]
									},
									{ type: 'text', text: ', and ' },
									{
										type: 'text',
										text: 'Project Ideas',
										marks: [{ type: 'textStyle', attrs: { color: 'var(--color-purple)' } }, { type: 'bold' }]
									},
									{ type: 'text', text: ')' }
								]
							}
						]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Create your own custom page using the ' },
									{ type: 'text', text: '+', marks: [{ type: 'bold' }] },
									{ type: 'text', text: ' button in the sidebar' }
								]
							}
						]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [
							{
								type: 'paragraph',
								content: [
									{ type: 'text', text: 'Click on any page icon to choose a custom icon and color theme' }
								]
							}
						]
					}
				]
			},
			{
				type: 'details',
				attrs: { open: false, level: 3 },
				content: [
					{
						type: 'detailsSummary',
						content: [{ type: 'text', text: 'Deep Dive: Collapsible Headings & Nested Toggles' }]
					},
					{
						type: 'detailsContent',
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: 'Toggle headings let you keep long documents structured and clean. You can toggle them open or closed with a single click, or use the Expand/Collapse all button in the top action bar.'
									}
								]
							}
						]
					}
				]
			},
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'Key Features' }]
			},
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: 'Block-Based Editor: ',
										marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'var(--color-blue)' } }]
									},
									{ type: 'text', text: 'Headings, checklists, code blocks, toggle headings, and custom database tables.' }
								]
							}
						]
					},
					{
						type: 'listItem',
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: 'Color-Coded Icons: ',
										marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'var(--color-yellow)' } }]
									},
									{ type: 'text', text: 'Give every document a distinct visual identity with curated accent colors.' }
								]
							}
						]
					},
					{
						type: 'listItem',
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: 'SQLite Full-Text Search: ',
										marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'var(--color-green)' } }]
									},
									{ type: 'text', text: 'Instant, blazing fast search across all your document titles and body content.' }
								]
							}
						]
					},
					{
						type: 'listItem',
						content: [
							{
								type: 'paragraph',
								content: [
									{
										type: 'text',
										text: 'Notion Import & Data Export: ',
										marks: [{ type: 'bold' }, { type: 'textStyle', attrs: { color: 'var(--color-purple)' } }]
									},
									{ type: 'text', text: 'Backup and restore your workspace as ZIP archives or import directly from Notion.' }
								]
							}
						]
					}
				]
			}
		]
	};
	await updatePage(page1.id, {
		contentJson: JSON.stringify(content1),
		contentText: extractTextFromJson(JSON.stringify(content1))
	});

	// 2. Shopping (Green icon)
	const page2 = await createPage(null, 'Shopping', 'lucide:shopping-cart', '#22c55e');
	const content2 = {
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'Weekly Groceries' }]
			},
			{
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fresh Organic Avocados & Spinach' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Almond Milk & Greek Yogurt' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Whole Grain Sourdough Bread' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cold Brew Coffee Beans' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Extra Virgin Olive Oil & Sea Salt' }] }]
					}
				]
			},
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'Household Essentials' }]
			},
			{
				type: 'taskList',
				content: [
					{
						type: 'taskItem',
						attrs: { checked: true },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Warm LED Light Bulbs' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Microfiber Cleaning Cloths' }] }]
					},
					{
						type: 'taskItem',
						attrs: { checked: false },
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dishwasher Pods & Sponge' }] }]
					}
				]
			}
		]
	};
	await updatePage(page2.id, {
		contentJson: JSON.stringify(content2),
		contentText: extractTextFromJson(JSON.stringify(content2))
	});

	// 3. Book Tracker (Blue icon)
	const page3 = await createPage(null, 'Book Tracker', 'lucide:book-open', '#3b82f6');
	const content3 = {
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'My Reading List' }]
			},
			{
				type: 'paragraph',
				content: [
					{
						type: 'text',
						text: 'Track books, reading status, and ratings using Aporia database blocks:'
					}
				]
			},
			{
				type: 'databaseBlock',
				attrs: {
					columns: [
						{ id: 'title', name: 'Book Title', type: 'text' },
						{ id: 'author', name: 'Author', type: 'text' },
						{ id: 'status', name: 'Status', type: 'status' },
						{ id: 'rating', name: 'Rating', type: 'status' }
					],
					rows: [
						{ id: 'row-1', title: 'Atomic Habits', author: 'James Clear', status: 'Completed', rating: '5 Stars' },
						{ id: 'row-2', title: 'Deep Work', author: 'Cal Newport', status: 'Completed', rating: '5 Stars' },
						{ id: 'row-3', title: 'Designing Data-Intensive Applications', author: 'Martin Kleppmann', status: 'Reading', rating: '4 Stars' },
						{ id: 'row-4', title: 'The Pragmatic Programmer', author: 'Andrew Hunt', status: 'Want to Read', rating: '5 Stars' }
					],
					options: {
						status: ['Completed', 'Reading', 'Want to Read'],
						rating: ['5 Stars', '4 Stars', '3 Stars']
					},
					showSummary: false,
					summary: {},
					sort: null
				}
			}
		]
	};
	await updatePage(page3.id, {
		contentJson: JSON.stringify(content3),
		contentText: extractTextFromJson(JSON.stringify(content3))
	});

	// 4. Project Ideas (Purple icon)
	const page4 = await createPage(null, 'Project Ideas', 'lucide:lightbulb', '#8b5cf6');
	const content4 = {
		type: 'doc',
		content: [
			{
				type: 'heading',
				attrs: { level: 2 },
				content: [{ type: 'text', text: 'Side Project Concepts' }]
			},
			{
				type: 'paragraph',
				content: [{ type: 'text', text: 'Notes and snippets for upcoming applications and features:' }]
			},
			{
				type: 'codeBlock',
				attrs: { language: 'typescript' },
				content: [
					{
						type: 'text',
						text: '// Aporia local-first database query example\nconst pages = await db.select().from(pagesTable).where(eq(pagesTable.isInTrash, 0));'
					}
				]
			},
			{
				type: 'bulletList',
				content: [
					{
						type: 'listItem',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Build Svelte 5 interactive block extensions.' }] }]
					},
					{
						type: 'listItem',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Optimize SQLite full-text search indexing.' }] }]
					}
				]
			}
		]
	};
	await updatePage(page4.id, {
		contentJson: JSON.stringify(content4),
		contentText: extractTextFromJson(JSON.stringify(content4))
	});

	return await getActivePages();
}
