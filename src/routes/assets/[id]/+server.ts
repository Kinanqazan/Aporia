import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readAsset } from '$lib/server/assets';

export const GET: RequestHandler = async ({ params, url }) => {
	const id = params.id;
	if (!id) throw error(404, 'Asset not found');
	const result = await readAsset(id);
	if (!result) throw error(404, 'Asset not found');

	const body = result.bytes.buffer.slice(
		result.bytes.byteOffset,
		result.bytes.byteOffset + result.bytes.byteLength
	) as ArrayBuffer;
	const inlineTypes = new Set(['application/pdf', 'application/json', 'text/plain', 'text/csv', 'text/markdown']);
	const forceDownload = url.searchParams.get('download') === '1';
	const canOpenInline = result.asset.mimeType.startsWith('image/') || inlineTypes.has(result.asset.mimeType);
	return new Response(body, {
		headers: {
			'Content-Type': result.asset.mimeType,
			'Content-Length': String(result.asset.byteSize),
			'Content-Disposition': canOpenInline && !forceDownload
				? 'inline'
				: `attachment; filename*=UTF-8''${encodeURIComponent(result.asset.originalFilename)}`,
			'Cache-Control': 'private, max-age=3600',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
