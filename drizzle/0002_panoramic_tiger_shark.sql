PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pages` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT 'Untitled' NOT NULL,
	`icon` text,
	`content_json` text DEFAULT '{"type":"doc","content":[]}' NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_locked` integer DEFAULT 0 NOT NULL,
	`is_in_trash` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`trash_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pages`("id", "parent_id", "position", "title", "icon", "content_json", "content_text", "schema_version", "revision", "is_locked", "is_in_trash", "created_at", "updated_at", "trash_at") SELECT "id", "parent_id", "position", "title", "icon", "content_json", "content_text", "schema_version", "revision", "is_locked", "is_in_trash", "created_at", "updated_at", "trash_at" FROM `pages`;--> statement-breakpoint
DROP TABLE `pages`;--> statement-breakpoint
ALTER TABLE `__new_pages` RENAME TO `pages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;