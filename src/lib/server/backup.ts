import JSZip from 'jszip';
import { db, sqlite } from './database';
import { pages, assets } from './schema';
import { readAsset } from './assets';
import { env } from '$env/dynamic/private';
import { dirname, join, resolve } from 'path';
import { mkdir, writeFile } from 'fs/promises';

const databasePath = env.DATABASE_URL || 'data/app.db';
const configuredUploadDirectory = env.UPLOAD_DIR || join(dirname(databasePath), 'uploads');
const uploadDirectory = resolve(configuredUploadDirectory);

export interface BackupManifest {
	version: number;
	exportedAt: string;
	pageCount: number;
	assetCount: number;
}

export async function createWorkspaceBackup(): Promise<Uint8Array> {
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
			if (data) {
				assetsFolder.file(asset.storageKey, data.bytes);
			}
		}
	}

	return await zip.generateAsync({ type: 'uint8array' });
}

export async function restoreWorkspaceBackup(archiveBuffer: ArrayBuffer | Uint8Array): Promise<{ pageCount: number; assetCount: number }> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(archiveBuffer);
	} catch {
		throw new Error('Selected file is not a valid ZIP archive');
	}

	const pagesFile = zip.file('pages.json');
	if (!pagesFile) {
		throw new Error('Invalid Aporia backup file: missing pages.json');
	}

	const pagesRaw = await pagesFile.async('string');
	const restoredPages = JSON.parse(pagesRaw);
	if (!Array.isArray(restoredPages)) {
		throw new Error('Invalid backup content in pages.json');
	}

	let restoredAssets: any[] = [];
	const assetsFile = zip.file('assets.json');
	if (assetsFile) {
		try {
			restoredAssets = JSON.parse(await assetsFile.async('string'));
		} catch {
			restoredAssets = [];
		}
	}

	let restoredSettings: { key: string; value: string }[] = [];
	const settingsFile = zip.file('settings.json');
	if (settingsFile) {
		try {
			restoredSettings = JSON.parse(await settingsFile.async('string'));
		} catch {
			restoredSettings = [];
		}
	}

	// 1. Database restoration inside atomic transaction
	sqlite.pragma('foreign_keys = OFF');
	try {
		db.transaction((tx) => {
			sqlite.prepare('DELETE FROM pages').run();
			sqlite.prepare('DELETE FROM assets').run();
			sqlite.prepare('DELETE FROM pages_fts').run();

			for (const p of restoredPages) {
				tx.insert(pages).values({
					id: p.id,
					parentId: p.parentId ?? null,
					position: p.position ?? 0,
					title: p.title ?? 'Untitled',
					icon: p.icon ?? null,
					iconColor: p.iconColor ?? null,
					contentJson: p.contentJson ?? '{"type":"doc","content":[]}',
					contentText: p.contentText ?? '',
					schemaVersion: p.schemaVersion ?? 1,
					revision: p.revision ?? 1,
					isLocked: p.isLocked ?? 0,
					isFullWidth: p.isFullWidth ?? 0,
					isInTrash: p.isInTrash ?? 0,
					createdAt: p.createdAt ?? new Date().toISOString(),
					updatedAt: p.updatedAt ?? new Date().toISOString(),
					trashAt: p.trashAt ?? null
				}).run();
			}

			for (const a of restoredAssets) {
				tx.insert(assets).values({
					id: a.id,
					storageKey: a.storageKey,
					originalFilename: a.originalFilename,
					mimeType: a.mimeType,
					byteSize: a.byteSize,
					createdAt: a.createdAt ?? new Date().toISOString()
				}).run();
			}

			const setStmt = sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
			for (const s of restoredSettings) {
				if (s.key && typeof s.value === 'string') {
					setStmt.run(s.key, s.value);
				}
			}

			sqlite.prepare(`
				INSERT INTO pages_fts (id, title, content_text)
				SELECT id, title, content_text FROM pages;
			`).run();
		});
	} finally {
		sqlite.pragma('foreign_keys = ON');
	}

	// 2. Unpack asset files to disk
	await mkdir(uploadDirectory, { recursive: true });
	const assetsFolder = zip.folder('assets');
	if (assetsFolder) {
		const files = Object.values(assetsFolder.files).filter(f => !f.dir);
		for (const file of files) {
			const filename = file.name.replace(/^assets\//, '');
			if (filename) {
				const targetPath = resolve(uploadDirectory, filename);
				// Path traversal safety check
				if (!targetPath.startsWith(uploadDirectory)) {
					continue;
				}
				const bytes = await file.async('uint8array');
				await writeFile(targetPath, bytes);
			}
		}
	}

	return {
		pageCount: restoredPages.length,
		assetCount: restoredAssets.length
	};
}
