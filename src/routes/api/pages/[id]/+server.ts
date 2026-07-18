import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePage } from '$lib/server/pages';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) {
		return json({ success: false, error: 'Invalid page ID' }, { status: 400 });
	}

	try {
		const { contentJson } = await request.json();
		if (typeof contentJson !== 'string') {
			return json({ success: false, error: 'contentJson must be a string' }, { status: 400 });
		}

		try {
			const document = JSON.parse(contentJson);
			if (document?.type !== 'doc') {
				return json({ success: false, error: 'contentJson must be a Tiptap document' }, { status: 400 });
			}
		} catch {
			return json({ success: false, error: 'contentJson must be valid JSON' }, { status: 400 });
		}
		
		// Update the contentJson field in the database
		const existingPage = await getPageById(id);
		if (!existingPage) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}
		if (existingPage.isLocked) {
			return json({ success: false, error: 'Page is locked' }, { status: 423 });
		}
		const page = await updatePage(id, { contentJson });
		if (!page) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}
		
		return json({ success: true });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
