import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema';
import { env } from '$env/dynamic/private';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const dbPath = env.DATABASE_URL || 'data/app.db';

// Ensure the target directory for the SQLite database exists
const dir = dirname(dbPath);
if (!existsSync(dir)) {
	mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(dbPath);

// Enable WAL journal mode for optimal SQLite performance and concurrency
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

// The pages table must exist before creating or backfilling the FTS index.
try {
	migrate(db, { migrationsFolder: './drizzle' });
} catch {
	// Fallback table creation if migration folder is missing in serverless build
}

sqlite.exec(`
	CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY,
		parent_id TEXT REFERENCES pages(id) ON DELETE CASCADE,
		position INTEGER NOT NULL DEFAULT 0,
		title TEXT NOT NULL DEFAULT 'Untitled',
		icon TEXT,
		icon_color TEXT,
		content_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
		content_text TEXT NOT NULL DEFAULT '',
		schema_version INTEGER NOT NULL DEFAULT 1,
		revision INTEGER NOT NULL DEFAULT 1,
		is_locked INTEGER NOT NULL DEFAULT 0,
		is_full_width INTEGER NOT NULL DEFAULT 0,
		is_in_trash INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL,
		updated_at TEXT NOT NULL,
		trash_at TEXT
	);

	CREATE TABLE IF NOT EXISTS assets (
		id TEXT PRIMARY KEY,
		storage_key TEXT NOT NULL UNIQUE,
		original_filename TEXT NOT NULL,
		mime_type TEXT NOT NULL,
		byte_size INTEGER NOT NULL,
		created_at TEXT NOT NULL
	);
`);

// Initialize Settings Table
sqlite.exec(`
	CREATE TABLE IF NOT EXISTS settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL
	);
`);

// Keep one authentication session per browser or installed PWA instead of
// storing a single global session in settings.
sqlite.exec(`
	CREATE TABLE IF NOT EXISTS auth_sessions (
		token_hash TEXT PRIMARY KEY,
		persistent INTEGER NOT NULL DEFAULT 0,
		created_at INTEGER NOT NULL,
		last_used_at INTEGER NOT NULL,
		expires_at INTEGER NOT NULL
	);
`);

// Initialize FTS5 Search
sqlite.exec(`
	CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
		id UNINDEXED,
		title,
		content_text
	);
`);

// Backfill existing pages into FTS index
sqlite.exec(`
	INSERT INTO pages_fts (id, title, content_text)
	SELECT id, title, content_text FROM pages
	WHERE id NOT IN (SELECT id FROM pages_fts);
`);

// Create triggers to keep FTS index synced
sqlite.exec(`
	CREATE TRIGGER IF NOT EXISTS pages_fts_ai AFTER INSERT ON pages BEGIN
		INSERT INTO pages_fts(id, title, content_text) VALUES(new.id, new.title, new.content_text);
	END;
`);

sqlite.exec(`
	CREATE TRIGGER IF NOT EXISTS pages_fts_ad AFTER DELETE ON pages BEGIN
		DELETE FROM pages_fts WHERE id = old.id;
	END;
`);

sqlite.exec(`
	CREATE TRIGGER IF NOT EXISTS pages_fts_au AFTER UPDATE ON pages BEGIN
		UPDATE pages_fts SET title = new.title, content_text = new.content_text WHERE id = old.id;
	END;
`);

export type DatabaseClient = typeof db;
export { sqlite };
