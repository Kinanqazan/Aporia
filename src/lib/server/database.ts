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

// Run migrations on startup
migrate(db, { migrationsFolder: './drizzle' });

export type DatabaseClient = typeof db;
export { sqlite };
