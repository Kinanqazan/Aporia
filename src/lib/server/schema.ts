import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';

export const pages = sqliteTable('pages', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	parentId: integer('parent_id').references(() => pages.id, { onDelete: 'cascade' }),
	position: integer('position').notNull().default(0),
	title: text('title').notNull().default('Untitled'),
	icon: text('icon'),
	contentJson: text('content_json').notNull().default('{"type":"doc","content":[]}'),
	contentText: text('content_text').notNull().default(''),
	schemaVersion: integer('schema_version').notNull().default(1),
	revision: integer('revision').notNull().default(1),
	isInTrash: integer('is_in_trash').notNull().default(0), // 0 = false, 1 = true
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull(),
	trashAt: text('trash_at')
});
