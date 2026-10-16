import JSZip from 'jszip';
import { db, sqlite } from './database';
import { pages, assets } from './schema';
import { publicAssetUrl, readAsset, type AssetRecord } from './assets';
import { extractTextFromJson, type PageNode } from './pages';
import { env } from '$env/dynamic/private';
import { dirname, join, resolve } from 'path';
import { lstatSync, renameSync, rmSync } from 'fs';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { withCleanupActivity, withUploadActivity } from './upload-activity';

const databasePath = env.DATABASE_URL || 'data/app.db';
const configuredUploadDirectory = env.UPLOAD_DIR || join(dirname(databasePath), 'uploads');
const uploadDirectory = resolve(configuredUploadDirectory);

export interface BackupManifest {
	version: number;
	exportedAt: string;
	pageCount: number;
	assetCount: number;
}

export function createWorkspaceBackup(): Promise<Uint8Array> {
	return withUploadActivity(createBackup);
}

async function createBackup(): Promise<Uint8Array> {
	const allPages = await db.select().from(pages);
	const allAssets = await db.select().from(assets);
	
	let allSettings: { key: string; value: string }[] = [];
	try {
		allSettings = sqlite.prepare("SELECT key, value FROM settings WHERE key NOT LIKE 'auth%'").all() as { key: string; value: string }[];
	} catch {
		allSettings = [];
	}

	const zip = new JSZip();

	const manifest: BackupManifest = {
		version: 1,
		exportedAt: new Date().toISOString(),
		pageCount: allPages.length,
		assetCount: allAssets.length
	};

	zip.file('manifest.json', JSON.stringify(manifest, null, 2));
	zip.file('pages.json', JSON.stringify(allPages, null, 2));
	zip.file('assets.json', JSON.stringify(allAssets, null, 2));
	zip.file('settings.json', JSON.stringify(allSettings, null, 2));

	const assetsFolder = zip.folder('assets');
	if (assetsFolder) {
		for (const asset of allAssets) {
			const data = await readAsset(asset.id);
			if (!data || data.bytes.byteLength !== asset.byteSize) {
				throw new Error(`Unable to back up ${asset.originalFilename}: the uploaded file is missing or incomplete`);
			}
			assetsFolder.file(asset.storageKey, data.bytes);
		}
	}

	return await zip.generateAsync({ type: 'uint8array' });
}

function record(value: unknown, label: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label} in backup`);
	return value as Record<string, unknown>;
}

function text(value: unknown, label: string, fallback?: string): string {
	const result = value ?? fallback;
	if (typeof result !== 'string') throw new Error(`Invalid ${label} in backup`);
	return result;
}

function nullableText(value: unknown, label: string): string | null {
	return value == null ? null : text(value, label);
}

function integer(value: unknown, label: string, fallback: number, minimum = 0): number {
	const result = value ?? fallback;
	if (typeof result !== 'number' || !Number.isSafeInteger(result) || result < minimum) {
		throw new Error(`Invalid ${label} in backup`);
	}
	return result;
}

function flag(value: unknown, label: string): number {
	const result = integer(value, label, 0);
	if (result > 1) throw new Error(`Invalid ${label} in backup`);
	return result;
}

function restorePage(value: unknown): PageNode {
	const page = record(value, 'page');
	const id = text(page.id, 'page ID');
	if (!id) throw new Error('Invalid page ID in backup');
	const contentJson = text(page.contentJson, 'page content', '{"type":"doc","content":[]}');
	try {
		const document = JSON.parse(contentJson);
		if (!document || typeof document !== 'object' || document.type !== 'doc') throw new Error();
	} catch {
		throw new Error(`Invalid content for page ${id} in backup`);
	}
	const now = new Date().toISOString();
	return {
		id, parentId: nullableText(page.parentId, 'page parent'),
		position: integer(page.position, 'page position', 0),
		title: text(page.title, 'page title', 'Untitled'),
		icon: nullableText(page.icon, 'page icon'), iconColor: nullableText(page.iconColor, 'page icon color'),
		contentJson, contentText: extractTextFromJson(contentJson),
		schemaVersion: integer(page.schemaVersion, 'page schema version', 1, 1),
		revision: integer(page.revision, 'page revision', 1, 1),
		isLocked: flag(page.isLocked, 'page lock'), isFullWidth: flag(page.isFullWidth, 'page width'),
		isInTrash: flag(page.isInTrash, 'page Trash state'),
		createdAt: text(page.createdAt, 'page creation date', now),
		updatedAt: text(page.updatedAt, 'page update date', now),
		trashAt: nullableText(page.trashAt, 'page Trash date')
	};
}

function validatePageTree(restoredPages: PageNode[]): void {
	const byId = new Map(restoredPages.map(page => [page.id, page]));
	if (byId.size !== restoredPages.length) throw new Error('Duplicate page IDs in backup');
	const checked = new Set<string>();
	for (const page of restoredPages) {
		let ancestor: PageNode | undefined = page;
		const path = new Set<string>();
		while (ancestor && !checked.has(ancestor.id)) {
			if (path.has(ancestor.id)) throw new Error('Page hierarchy contains a cycle in backup');
			path.add(ancestor.id);
			if (ancestor.parentId === null) break;
			const parent: PageNode | undefined = byId.get(ancestor.parentId);
			if (!parent) throw new Error(`Missing parent for page ${ancestor.id} in backup`);
			ancestor = parent;
		}
		for (const id of path) checked.add(id);
	}
}

function restoreAsset(value: unknown): AssetRecord {
	const asset = record(value, 'asset');
	const id = text(asset.id, 'asset ID');
	const storageKey = text(asset.storageKey, 'asset storage key');
	// Uploads are flat files. Reject separators on every platform, including
	// Windows backslashes that ZIP path normalization does not remove.
	if (!id || !storageKey || /[\\/:*?"<>|\u0000-\u001f]/.test(storageKey) || /[. ]$/.test(storageKey) ||
		/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(storageKey) ||
		dirname(resolve(uploadDirectory, storageKey)) !== uploadDirectory) {
		throw new Error('Invalid asset storage key in backup');
	}
	const mimeType = text(asset.mimeType, 'asset MIME type');
	if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(mimeType)) {
		throw new Error('Invalid asset MIME type in backup');
	}
	return {
		id, storageKey, originalFilename: text(asset.originalFilename, 'asset filename'), mimeType,
		byteSize: integer(asset.byteSize, 'asset byte size', 0),
		createdAt: text(asset.createdAt, 'asset creation date', new Date().toISOString())
	};
}

function validateRestoredAssetReferences(restoredPages: PageNode[], restoredAssets: AssetRecord[]): void {
	const byId = new Map(restoredAssets.map(asset => [asset.id, asset]));
	for (const page of restoredPages) {
		const pending: unknown[] = [JSON.parse(page.contentJson)];
		while (pending.length) {
			const value = pending.pop();
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			const node = value as Record<string, unknown>;
			const attrs = node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)
				? node.attrs as Record<string, unknown> : {};
			if (node.type === 'fileAttachment' || (node.type === 'image' && attrs.source === 'upload')) {
				const asset = typeof attrs.assetId === 'string' ? byId.get(attrs.assetId) : undefined;
				if (!asset) throw new Error(`Missing asset referenced by page ${page.id} in backup`);
				const valid = node.type === 'fileAttachment'
					? attrs.fileName === asset.originalFilename && attrs.mimeType === asset.mimeType && attrs.size === asset.byteSize
					: attrs.src === publicAssetUrl(asset.id);
				if (!valid) throw new Error(`Invalid asset reference on page ${page.id} in backup`);
			}
			if (Array.isArray(node.content)) pending.push(...node.content);
		}
	}
}

async function readBackupArray(zip: JSZip, name: string, required = false): Promise<unknown[]> {
	const file = zip.file(name);
	if (!file) {
		if (required) throw new Error(`Invalid Aporia backup file: missing ${name}`);
		return [];
	}
	try {
		const values = JSON.parse(await file.async('string'));
		if (!Array.isArray(values)) throw new Error();
		return values;
	} catch {
		throw new Error(`Invalid backup content in ${name}`);
	}
}

export function restoreWorkspaceBackup(archiveBuffer: ArrayBuffer | Uint8Array): Promise<{ pageCount: number; assetCount: number }> {
	return withCleanupActivity(() => restoreBackup(archiveBuffer));
}

async function restoreBackup(archiveBuffer: ArrayBuffer | Uint8Array): Promise<{ pageCount: number; assetCount: number }> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(archiveBuffer, { checkCRC32: true });
	} catch {
		throw new Error('Selected file is not a valid ZIP archive');
	}

	const restoredPages = (await readBackupArray(zip, 'pages.json', true)).map(restorePage);
	validatePageTree(restoredPages);
	const restoredAssets = (await readBackupArray(zip, 'assets.json')).map(restoreAsset);
	if (new Set(restoredAssets.map(asset => asset.id)).size !== restoredAssets.length ||
		new Set(restoredAssets.map(asset => process.platform === 'win32' ? asset.storageKey.toLowerCase() : asset.storageKey)).size !== restoredAssets.length) {
		throw new Error('Duplicate assets in backup');
	}
	validateRestoredAssetReferences(restoredPages, restoredAssets);
	const restoredSettings = (await readBackupArray(zip, 'settings.json')).map(value => {
		const setting = record(value, 'setting');
		return { key: text(setting.key, 'setting key'), value: text(setting.value, 'setting value') };
	});
	const expectedFiles = new Set(['manifest.json', 'pages.json', 'assets.json', 'settings.json',
		...restoredAssets.map(asset => `assets/${asset.storageKey}`)]);
	for (const file of Object.values(zip.files)) {
		if (!file.dir && (!expectedFiles.has(file.name) || (file.unsafeOriginalName && file.unsafeOriginalName !== file.name))) {
			throw new Error(`Unexpected file in backup: ${file.name}`);
		}
	}

	await mkdir(uploadDirectory, { recursive: true });
	const stagingDirectory = await mkdtemp(join(uploadDirectory, '.aporia-restore-'));
	const staged: Array<{ finalPath: string; incomingPath: string; previousPath: string; hadPrevious: boolean; installed: boolean }> = [];
	let preserveStaging = false;
	const foreignKeys = sqlite.pragma('foreign_keys', { simple: true }) as number;
	try {
		// Finish decompression, size validation and disk writes before replacing
		// either the saved workspace or any current uploaded file.
		for (const [index, asset] of restoredAssets.entries()) {
			const file = zip.file(`assets/${asset.storageKey}`);
			if (!file) throw new Error(`Missing uploaded file in backup: ${asset.originalFilename}`);
			const bytes = await file.async('uint8array');
			if (bytes.byteLength !== asset.byteSize) throw new Error(`Incomplete uploaded file in backup: ${asset.originalFilename}`);
			const incomingPath = join(stagingDirectory, `incoming-${index}`);
			await writeFile(incomingPath, bytes);
			staged.push({
				finalPath: resolve(uploadDirectory, asset.storageKey), incomingPath,
				previousPath: join(stagingDirectory, `previous-${index}`), hadPrevious: false, installed: false
			});
		}

		sqlite.pragma('foreign_keys = OFF');
		db.transaction((tx) => {
			// Renames are synchronous inside the transaction so another request
			// cannot observe a new database before its uploaded files are ready.
			for (const file of staged) {
				try {
					const existing = lstatSync(file.finalPath);
					if (!existing.isFile() && !existing.isSymbolicLink()) throw new Error('An upload destination is not a file');
					renameSync(file.finalPath, file.previousPath);
					file.hadPrevious = true;
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				}
				renameSync(file.incomingPath, file.finalPath);
				file.installed = true;
			}
			sqlite.prepare('DELETE FROM pages').run();
			sqlite.prepare('DELETE FROM assets').run();
			sqlite.prepare('DELETE FROM pages_fts').run();
			sqlite.prepare('DELETE FROM mcp_requests').run();

			for (const p of restoredPages) {
				tx.insert(pages).values(p).run();
			}

			for (const a of restoredAssets) {
				tx.insert(assets).values(a).run();
			}

			const setStmt = sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
			for (const s of restoredSettings) {
				if (s.key && !s.key.toLowerCase().startsWith('auth') && s.key !== 'mcp_workspace_generation') {
					setStmt.run(s.key, s.value);
				}
			}
			sqlite.prepare("INSERT INTO settings (key, value) VALUES ('mcp_workspace_generation', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(randomUUID());
			// The existing pages_fts_ai trigger indexes each inserted page once.
		});
	} catch (error) {
		const rollbackErrors: unknown[] = [];
		for (const file of staged.reverse()) {
			try {
				if (file.installed) rmSync(file.finalPath, { force: true });
				if (file.hadPrevious) renameSync(file.previousPath, file.finalPath);
			} catch (rollbackError) { rollbackErrors.push(rollbackError); }
		}
		if (rollbackErrors.length) {
			// Keep recoverable original uploads if the disk also rejects rollback.
			preserveStaging = true;
			throw new AggregateError([error, ...rollbackErrors], `Restore failed; original uploads were retained in ${stagingDirectory}`);
		}
		throw error;
	} finally {
		sqlite.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
		if (!preserveStaging) await rm(stagingDirectory, { recursive: true, force: true }).catch(error => {
			console.warn('Unable to remove backup staging directory:', error);
		});
	}

	return {
		pageCount: restoredPages.length,
		assetCount: restoredAssets.length
	};
}
