import { randomUUID } from 'node:crypto';
import { sqlite } from '$lib/server/database';
import { pageVersion as encodePageVersion, parsePageVersion } from './page-version.js';

export { parsePageVersion };

export function pageVersion(revision: number, generation = getWorkspaceGeneration()): string {
	return encodePageVersion(revision, generation);
}

const GENERATION_KEY = 'mcp_workspace_generation';

export function getWorkspaceGeneration(): string {
	let generation = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(GENERATION_KEY) as
		| { value: string }
		| undefined;
	if (!generation) {
		const value = randomUUID();
		sqlite.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(GENERATION_KEY, value);
		generation = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(GENERATION_KEY) as { value: string };
	}
	return generation.value;
}

export function versionMatches(version: string, revision: number): boolean {
	const parsed = parsePageVersion(version);
	return parsed !== null && parsed.generation === getWorkspaceGeneration() && parsed.revision === revision;
}
