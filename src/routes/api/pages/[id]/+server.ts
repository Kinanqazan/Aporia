import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updatePage } from '$lib/server/pages';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) {
		return json({ success: false, error: 'Invalid page ID' }, { status: 400 });
	}

	try {
		const { contentJson } = await request.json();
		
		// Update the contentJson field in the database
		await updatePage(id, { contentJson });
		
		return json({ success: true });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
