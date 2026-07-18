import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePage } from '$lib/server/pages';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) {
		return json({ success: false, error: 'Invalid page ID' }, { status: 400 });
	}

	try {
		const body = await request.json();
		if (typeof body?.isLocked !== 'boolean') {
			return json({ success: false, error: 'isLocked must be a boolean' }, { status: 400 });
		}

		const existingPage = await getPageById(id);
		if (!existingPage || existingPage.isInTrash) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}

		const page = await updatePage(id, { isLocked: body.isLocked ? 1 : 0 });
		if (!page) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}

		return json({ success: true, isLocked: page.isLocked === 1 });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
