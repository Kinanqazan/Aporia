import { redirect, type RequestHandler } from '@sveltejs/kit';
import { createPageFromSharedContent } from '$lib/server/shared-content';

export const POST: RequestHandler = async ({ request }) => {
	const form = await request.formData();
	const page = await createPageFromSharedContent({
		title: form.get('title'),
		text: form.get('text'),
		url: form.get('url')
	});
	throw redirect(303, `/${page.id}`);
};
