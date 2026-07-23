import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { NotionImportError, previewNotionHtmlImport } from '$lib/server/notion-import/html';

export const POST: RequestHandler = async ({ request, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return json({ success: false, error: 'Invalid request origin' }, { status: 403 });

	const formData = await request.formData();
	const archive = formData.get('archive');
	if (!(archive instanceof File)) return json({ success: false, error: 'A Notion HTML or ZIP export file is required' }, { status: 400 });

	try {
		return json({ success: true, preview: await previewNotionHtmlImport(archive) });
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unable to read the Notion export';
		return json({ success: false, error: message }, { status: error instanceof NotionImportError ? 400 : 500 });
	}
};
