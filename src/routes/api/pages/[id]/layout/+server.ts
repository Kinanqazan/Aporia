import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePage } from '$lib/server/pages';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) {
		return json({ success: false, error: 'Invalid page ID' }, { status: 400 });
	}

	try {
		const body = await request.json();
		if (typeof body?.isFullWidth !== 'boolean') {
			return json({ success: false, error: 'isFullWidth must be a boolean' }, { status: 400 });
		}

		const existingPage = await getPageById(id);
		if (!existingPage || existingPage.isInTrash) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}
		if (existingPage.isLocked) {
			return json({ success: false, error: 'Page is locked' }, { status: 423 });
		}

		const page = await updatePage(id, { isFullWidth: body.isFullWidth ? 1 : 0 });
		if (!page) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}

		return json({ success: true, isFullWidth: page.isFullWidth === 1 });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
