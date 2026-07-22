import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cleanupUnusedAssets } from '$lib/server/assets';

export const POST: RequestHandler = async ({ request, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) {
		return json({ success: false, error: 'Invalid request origin' }, { status: 403 });
	}

	try {
		const result = await cleanupUnusedAssets();
		return json({
			success: true,
			removed: result.deletedCount,
			bytesFreed: result.deletedBytes
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to clean uploads';
		return json({ success: false, error: message }, { status: 500 });
	}
};
