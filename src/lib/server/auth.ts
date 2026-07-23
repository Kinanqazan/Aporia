import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sqlite } from './database';

const scryptAsync = promisify(scrypt);
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const SESSION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = 'aporia_session';
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

const PASSWORD_HASH_KEY = 'auth.password.hash';
const PASSWORD_SALT_KEY = 'auth.password.salt';
const USERNAME_KEY = 'auth.username';

type SettingRow = { value: string } | undefined;
type SessionRow = {
	token_hash: string;
	persistent: number;
	created_at: number;
	last_used_at: number;
	expires_at: number;
};

function getSetting(key: string): string | undefined {
	const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow;
	return row?.value;
}

function setSetting(key: string, value: string): void {
	sqlite
		.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.run(key, value);
}

export function sessionCookieOptions(persistent: boolean) {
	return {
		path: '/',
		httpOnly: true,
		sameSite: 'strict' as const,
		secure: process.env.NODE_ENV === 'production',
		...(persistent ? { maxAge: SESSION_MAX_AGE_SECONDS } : {})
	};
}

async function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
	return (await scryptAsync(password, salt, PASSWORD_KEY_LENGTH)) as Buffer;
}

function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

export function isPasswordConfigured(): boolean {
	return Boolean(getSetting(PASSWORD_HASH_KEY) && getSetting(PASSWORD_SALT_KEY) && getSetting(USERNAME_KEY));
}

export async function configurePassword(username: string, password: string): Promise<boolean> {
	const normalizedUsername = username.trim().toLowerCase();
	const salt = randomBytes(PASSWORD_SALT_LENGTH);
	const passwordHash = await hashPassword(password, salt);

	const configure = sqlite.transaction(() => {
		if (getSetting(PASSWORD_HASH_KEY) || getSetting(USERNAME_KEY)) return false;

		setSetting(USERNAME_KEY, normalizedUsername);
		setSetting(PASSWORD_HASH_KEY, passwordHash.toString('hex'));
		setSetting(PASSWORD_SALT_KEY, salt.toString('hex'));
		deleteAllSessions();
		return true;
	});

	return configure();
}

export function getUsername(): string | undefined {
	return getSetting(USERNAME_KEY);
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
	const storedUsername = getUsername();
	if (!storedUsername || storedUsername !== username.trim().toLowerCase()) return false;

	const hashHex = getSetting(PASSWORD_HASH_KEY);
	const saltHex = getSetting(PASSWORD_SALT_KEY);
	if (!hashHex || !saltHex) return false;

	const expectedHash = Buffer.from(hashHex, 'hex');
	const actualHash = await hashPassword(password, Buffer.from(saltHex, 'hex'));
	return expectedHash.length === actualHash.length && timingSafeEqual(expectedHash, actualHash);
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
	const username = getUsername();
	if (!username || !(await verifyCredentials(username, currentPassword))) return false;

	const salt = randomBytes(PASSWORD_SALT_LENGTH);
	const passwordHash = await hashPassword(newPassword, salt);
	const update = sqlite.transaction(() => {
		setSetting(PASSWORD_HASH_KEY, passwordHash.toString('hex'));
		setSetting(PASSWORD_SALT_KEY, salt.toString('hex'));
		deleteAllSessions();
	});
	update();
	return true;
}

export function createSession(persistent: boolean): string {
	const token = randomBytes(32).toString('base64url');
	const now = Date.now();
	sqlite
		.prepare(`
			INSERT INTO auth_sessions (token_hash, persistent, created_at, last_used_at, expires_at)
			VALUES (?, ?, ?, ?, ?)
		`)
		.run(hashSessionToken(token), persistent ? 1 : 0, now, now, now + SESSION_TTL_MS);
	return token;
}

export function getValidSession(token: string | undefined): SessionRow | undefined {
	if (!token) return undefined;

	const tokenHash = hashSessionToken(token);
	const session = sqlite
		.prepare('SELECT token_hash, persistent, created_at, last_used_at, expires_at FROM auth_sessions WHERE token_hash = ?')
		.get(tokenHash) as SessionRow | undefined;
	if (!session) return undefined;

	if (session.expires_at <= Date.now()) {
		deleteSession(token);
		return undefined;
	}

	const now = Date.now();
	sqlite
		.prepare('UPDATE auth_sessions SET last_used_at = ?, expires_at = ? WHERE token_hash = ?')
		.run(now, now + SESSION_TTL_MS, session.token_hash);

	return { ...session, last_used_at: now, expires_at: now + SESSION_TTL_MS };
}

export function hasValidSession(token: string | undefined): boolean {
	return Boolean(getValidSession(token));
}

export function deleteSession(token: string | undefined): void {
	if (!token) return;
	sqlite.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashSessionToken(token));
}

export function deleteAllSessions(): void {
	sqlite.prepare('DELETE FROM auth_sessions').run();
}
