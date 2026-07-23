import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

// The self-referencing parent relation otherwise creates a circular type
// inference error with newer TypeScript/Drizzle combinations.
export const pages: any = sqliteTable('pages', {
	id: text('id').primaryKey(),
	parentId: text('parent_id').references(() => pages.id, { onDelete: 'cascade' }),
	position: integer('position').notNull().default(0),
	title: text('title').notNull().default('Untitled'),
	icon: text('icon'),
	iconColor: text('icon_color'),
	contentJson: text('content_json').notNull().default('{"type":"doc","content":[]}'),
	contentText: text('content_text').notNull().default(''),
	schemaVersion: integer('schema_version').notNull().default(1),
	revision: integer('revision').notNull().default(1),
	isLocked: integer('is_locked').notNull().default(0), // 0 = unlocked, 1 = locked
	isFullWidth: integer('is_full_width').notNull().default(0), // 0 = constrained, 1 = full width
	isInTrash: integer('is_in_trash').notNull().default(0), // 0 = false, 1 = true
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	trashAt: text('trash_at')
});

export const assets = sqliteTable('assets', {
	id: text('id').primaryKey(),
	storageKey: text('storage_key').notNull().unique(),
	originalFilename: text('original_filename').notNull(),
	mimeType: text('mime_type').notNull(),
	byteSize: integer('byte_size').notNull(),
	createdAt: text('created_at').notNull()
});
