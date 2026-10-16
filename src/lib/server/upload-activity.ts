import { randomUUID } from 'node:crypto';
import { sqlite } from './database';

// Shared, expiring reservations protect uploads until their page is saved.
// A crashed browser or worker cannot leave cleanup permanently blocked.
const ACTIVITY_TTL_MS = 10 * 60 * 1000;
const HEARTBEAT_MS = 30 * 1000;
type ActivityKind = 'upload' | 'cleanup';

export class UploadActivityError extends Error {
	readonly status = 409;
}

function beginActivity(kind: ActivityKind): string {
	return sqlite.transaction(() => {
		const now = Date.now();
		sqlite.prepare('DELETE FROM upload_activity WHERE expires_at <= ?').run(now);
		const busy = kind === 'cleanup'
			? sqlite.prepare('SELECT id FROM upload_activity LIMIT 1').get()
			: sqlite.prepare("SELECT id FROM upload_activity WHERE kind = 'cleanup' LIMIT 1").get();
		if (busy) {
			throw new UploadActivityError(kind === 'cleanup'
				? 'An upload, import, or cleanup is still finishing. Please try again shortly.'
				: 'Upload cleanup is running. Please try uploading again shortly.');
		}
		const id = randomUUID();
		sqlite.prepare('INSERT INTO upload_activity (id, kind, expires_at) VALUES (?, ?, ?)').run(id, kind, now + ACTIVITY_TTL_MS);
		return id;
	}).immediate();
}

export function beginUploadActivity(): string {
	return beginActivity('upload');
}

export function renewUploadActivity(id: string): void {
	const now = Date.now();
	const result = sqlite.prepare(
		"UPDATE upload_activity SET expires_at = ? WHERE id = ? AND kind = 'upload' AND expires_at > ?"
	).run(now + ACTIVITY_TTL_MS, id, now);
	if (!result.changes) throw new UploadActivityError('The upload session expired. Please try uploading again.');
}

export function finishUploadActivity(id: string): void {
	sqlite.prepare("DELETE FROM upload_activity WHERE id = ? AND kind = 'upload'").run(id);
}

async function withActivity<T>(kind: ActivityKind, work: () => Promise<T>): Promise<T> {
	const id = beginActivity(kind);
	const heartbeat = setInterval(() => {
		try {
			sqlite.prepare('UPDATE upload_activity SET expires_at = ? WHERE id = ?').run(Date.now() + ACTIVITY_TTL_MS, id);
		} catch (error) {
			console.error('Unable to renew upload activity:', error);
		}
	}, HEARTBEAT_MS);
	heartbeat.unref();
	try {
		return await work();
	} finally {
		clearInterval(heartbeat);
		sqlite.prepare('DELETE FROM upload_activity WHERE id = ?').run(id);
	}
}

export function withUploadActivity<T>(work: () => Promise<T>): Promise<T> {
	return withActivity('upload', work);
}

export function withCleanupActivity<T>(work: () => Promise<T>): Promise<T> {
	return withActivity('cleanup', work);
}
