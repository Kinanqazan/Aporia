import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createPageFromSharedContent, type SharedContentInput } from '$lib/server/shared-content';

export const POST: RequestHandler = async ({ request }) => {
	let payload: unknown;
	try {
		payload = await request.json();
	} catch {
		return json({ success: false, error: 'Invalid share payload.' }, { status: 400 });
	}
	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return json({ success: false, error: 'Invalid share payload.' }, { status: 400 });
	}

	try {
		const page = await createPageFromSharedContent(payload as SharedContentInput);
		return json({ success: true, pageId: page.id });
	} catch (error) {
		return json({
			success: false,
			error: error instanceof Error ? error.message : 'Could not save the shared item.'
		}, { status: 400 });
	}
};
