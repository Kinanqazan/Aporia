CREATE TABLE `pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_id` integer,
	`position` integer DEFAULT 0 NOT NULL,
	`title` text DEFAULT 'Untitled' NOT NULL,
	`icon` text,
	`content_json` text DEFAULT '{"type":"doc","content":[]}' NOT NULL,
	`content_text` text DEFAULT '' NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`is_in_trash` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`trash_at` text,
	FOREIGN KEY (`parent_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
