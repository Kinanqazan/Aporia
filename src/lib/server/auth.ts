import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sqlite } from './database';

const scryptAsync = promisify(scrypt);
const PASSWORD_KEY_LENGTH = 64;
const PASSWORD_SALT_LENGTH = 16;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PASSWORD_HASH_KEY = 'auth.password.hash';
const PASSWORD_SALT_KEY = 'auth.password.salt';
const USERNAME_KEY = 'auth.username';
const SESSION_HASH_KEY = 'auth.session.hash';
const SESSION_EXPIRES_KEY = 'auth.session.expires';

type SettingRow = { value: string } | undefined;

function getSetting(key: string): string | undefined {
	const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as SettingRow;
	return row?.value;
}

function setSetting(key: string, value: string): void {
	sqlite
		.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.run(key, value);
}

function deleteSetting(key: string): void {
	sqlite.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

function equalStrings(left: string, right: string): boolean {
	const leftBuffer = Buffer.from(left);
	const rightBuffer = Buffer.from(right);
	return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
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
		deleteSession();
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
		deleteSession();
	});
	update();
	return true;
}

export function createSession(): string {
	const token = randomBytes(32).toString('base64url');
	setSetting(SESSION_HASH_KEY, hashSessionToken(token));
	setSetting(SESSION_EXPIRES_KEY, String(Date.now() + SESSION_TTL_MS));
	return token;
}

export function hasValidSession(token: string | undefined): boolean {
	const storedHash = getSetting(SESSION_HASH_KEY);
	const expiresAt = Number(getSetting(SESSION_EXPIRES_KEY));
	if (!token || !storedHash || !Number.isFinite(expiresAt)) return false;
	if (expiresAt <= Date.now()) {
		deleteSession();
		return false;
	}

	return equalStrings(hashSessionToken(token), storedHash);
}

export function deleteSession(): void {
	deleteSetting(SESSION_HASH_KEY);
	deleteSetting(SESSION_EXPIRES_KEY);
}
