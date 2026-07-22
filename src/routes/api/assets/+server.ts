import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { AssetValidationError, publicAssetUrl, storeImage } from '$lib/server/assets';
import { getPageById } from '$lib/server/pages';

export const POST: RequestHandler = async ({ request, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) {
		return json({ success: false, error: 'Invalid request origin' }, { status: 403 });
	}

	const formData = await request.formData();
	const pageId = formData.get('pageId');
	const file = formData.get('file');
	if (typeof pageId !== 'string' || !(file instanceof File)) {
		return json({ success: false, error: 'A page and image file are required' }, { status: 400 });
	}

	const page = await getPageById(pageId);
	if (!page || page.isInTrash) return json({ success: false, error: 'Page not found' }, { status: 404 });
	if (page.isLocked) return json({ success: false, error: 'Page is locked' }, { status: 423 });

	try {
		const asset = await storeImage(file);
		return json({
			success: true,
			image: {
				src: publicAssetUrl(asset.id),
				source: 'upload',
				assetId: asset.id,
				alt: '',
				title: asset.originalFilename
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to upload image';
		return json({ success: false, error: message }, { status: error instanceof AssetValidationError ? 400 : 500 });
	}
};
