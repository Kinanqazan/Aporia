import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readAsset } from '$lib/server/assets';

export const GET: RequestHandler = async ({ params }) => {
	const id = params.id;
	if (!id) throw error(404, 'Asset not found');
	const result = await readAsset(id);
	if (!result) throw error(404, 'Asset not found');

	const body = result.bytes.buffer.slice(
		result.bytes.byteOffset,
		result.bytes.byteOffset + result.bytes.byteLength
	) as ArrayBuffer;
	return new Response(body, {
		headers: {
			'Content-Type': result.asset.mimeType,
			'Content-Length': String(result.asset.byteSize),
			'Cache-Control': 'private, max-age=3600',
			'X-Content-Type-Options': 'nosniff'
		}
	});
};
