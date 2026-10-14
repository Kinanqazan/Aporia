import { error, redirect, type RequestHandler } from '@sveltejs/kit';
import { createPageFromSharedContent, createPageFromSharedFiles } from '$lib/server/shared-content';

export const POST: RequestHandler = async ({ request, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) throw error(403, 'Invalid request origin');
	const form = await request.formData();
	const input = {
		title: form.get('title'),
		text: form.get('text'),
		url: form.get('url')
	};
	const files = form.getAll('files').filter((value): value is File => value instanceof File && value.size > 0);
	const page = files.length > 0
		? await createPageFromSharedFiles(input, files)
		: await createPageFromSharedContent(input);
	throw redirect(303, `/${page.id}`);
};
