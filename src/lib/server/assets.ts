import { env } from '$env/dynamic/private';
import { assets, pages } from './schema';
import { db } from './database';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { dirname, extname, join, resolve } from 'path';
import { mkdir, readFile, rename, rm, writeFile } from 'fs/promises';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const databasePath = env.DATABASE_URL || 'data/app.db';
const configuredUploadDirectory = env.UPLOAD_DIR || join(dirname(databasePath), 'uploads');
const uploadDirectory = resolve(configuredUploadDirectory);

const imageTypes = {
	'jpeg': { mimeType: 'image/jpeg', extension: '.jpg' },
	'png': { mimeType: 'image/png', extension: '.png' },
	'gif': { mimeType: 'image/gif', extension: '.gif' },
	'webp': { mimeType: 'image/webp', extension: '.webp' }
} as const;

export type AssetRecord = typeof assets.$inferSelect;

export class AssetValidationError extends Error {}

function createAssetId(): string {
	return randomBytes(18).toString('base64url');
}

function identifyImage(bytes: Uint8Array): (typeof imageTypes)[keyof typeof imageTypes] | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return imageTypes.jpeg;
	}
	if (
		bytes.length >= 8 &&
		bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
		bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
	) {
		return imageTypes.png;
	}
	if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a') return imageTypes.gif;
	if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a') return imageTypes.gif;
	if (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
	) {
		return imageTypes.webp;
	}
	return null;
}

function safeOriginalFilename(filename: string, extension: string): string {
	const trimmed = filename.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
	if (!trimmed) return `image${extension}`;
	return extname(trimmed) ? trimmed : `${trimmed}${extension}`;
}

function pathForStorageKey(storageKey: string): string {
	const path = resolve(uploadDirectory, storageKey);
	if (dirname(path) !== uploadDirectory) {
		throw new Error('Invalid asset path');
	}
	return path;
}

export function publicAssetUrl(id: string): string {
	return `/assets/${id}`;
}

export async function storeImage(file: File): Promise<AssetRecord> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	return storeImageBytes(file.name, bytes);
}

/** Stores validated image bytes from an upload or a trusted server-side importer. */
export async function storeImageBytes(filename: string, bytes: Uint8Array): Promise<AssetRecord> {
	if (bytes.byteLength === 0) throw new AssetValidationError('Choose an image file to upload');
	if (bytes.byteLength > MAX_IMAGE_BYTES) throw new AssetValidationError('Images must be 10 MB or smaller');

	const image = identifyImage(bytes);
	if (!image) {
		throw new AssetValidationError('Only PNG, JPEG, GIF, and WebP images are supported');
	}

	const id = createAssetId();
	const storageKey = `${id}${image.extension}`;
	const asset: AssetRecord = {
		id,
		storageKey,
		originalFilename: safeOriginalFilename(filename, image.extension),
		mimeType: image.mimeType,
		byteSize: bytes.byteLength,
		createdAt: new Date().toISOString()
	};

	await mkdir(uploadDirectory, { recursive: true });
	const finalPath = pathForStorageKey(storageKey);
	const temporaryPath = `${finalPath}.${createAssetId()}.uploading`;
	await writeFile(temporaryPath, bytes);

	try {
		await db.insert(assets).values(asset);
		await rename(temporaryPath, finalPath);
		return asset;
	} catch (error) {
		await rm(temporaryPath, { force: true });
		await rm(finalPath, { force: true });
		await db.delete(assets).where(eq(assets.id, id));
		throw error;
	}
}

/** Removes an asset created by an interrupted import before any page can reference it. */
export async function removeAsset(id: string): Promise<void> {
	const asset = await getAsset(id);
	if (!asset) return;
	await rm(pathForStorageKey(asset.storageKey), { force: true });
	await db.delete(assets).where(eq(assets.id, id));
}

export async function getAsset(id: string): Promise<AssetRecord | null> {
	const result = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
	return result[0] ?? null;
}

export async function readAsset(id: string): Promise<{ asset: AssetRecord; bytes: Uint8Array } | null> {
	const asset = await getAsset(id);
	if (!asset) return null;
	try {
		return { asset, bytes: await readFile(pathForStorageKey(asset.storageKey)) };
	} catch {
		return null;
	}
}

function collectReferencedAssetIds(node: any, ids: Set<string>) {
	if (!node || typeof node !== 'object') return;
	if (node.type === 'image' && node.attrs?.source === 'upload' && typeof node.attrs.assetId === 'string') {
		ids.add(node.attrs.assetId);
	}
	if (Array.isArray(node.content)) {
		for (const child of node.content) collectReferencedAssetIds(child, ids);
	}
}

export async function cleanupUnusedAssets(): Promise<{ deletedCount: number; deletedBytes: number }> {
	const referencedIds = new Set<string>();
	const documents = await db.select({ contentJson: pages.contentJson }).from(pages);

	for (const document of documents) {
		try {
			collectReferencedAssetIds(JSON.parse(document.contentJson), referencedIds);
		} catch {
			// A malformed document must never cause potentially referenced assets to be deleted.
			throw new Error('Cleanup stopped because a page has invalid content');
		}
	}

	const allAssets = await db.select().from(assets);
	const unusedAssets = allAssets.filter((asset) => !referencedIds.has(asset.id));
	let deletedBytes = 0;

	for (const asset of unusedAssets) {
		await rm(pathForStorageKey(asset.storageKey), { force: true });
		await db.delete(assets).where(eq(assets.id, asset.id));
		deletedBytes += asset.byteSize;
	}

	return { deletedCount: unusedAssets.length, deletedBytes };
}

export async function validateImageReferences(document: unknown): Promise<string | null> {
	const visit = async (node: any): Promise<string | null> => {
		if (!node || typeof node !== 'object') return null;
		if (node.type === 'image') {
			const attrs = node.attrs ?? {};
			if (attrs.source === 'upload') {
				if (typeof attrs.assetId !== 'string') return 'Uploaded images must reference an asset';
				const asset = await getAsset(attrs.assetId);
				if (!asset || attrs.src !== publicAssetUrl(asset.id)) return 'Invalid uploaded image reference';
			} else if (attrs.source === 'remote') {
				if (typeof attrs.src !== 'string' || attrs.assetId !== null) return 'Invalid remote image reference';
				try {
					if (new URL(attrs.src).protocol !== 'https:') return 'Remote images must use HTTPS';
				} catch {
					return 'Invalid remote image URL';
				}
			} else {
				return 'Invalid image source';
			}
		}
		if (!Array.isArray(node.content)) return null;
		for (const child of node.content) {
			const error = await visit(child);
			if (error) return error;
		}
		return null;
	};
	return visit(document);
}
