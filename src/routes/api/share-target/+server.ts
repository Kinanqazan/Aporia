import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	appendSharedFilesToPage,
	appendSharedLinkToPage,
	createPageFromSharedContent,
	SharedContentError,
	type SharedContentInput
} from '$lib/server/shared-content';

export const POST: RequestHandler = async ({ request, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) {
		return json({ success: false, error: 'Invalid request origin' }, { status: 403 });
	}

	if (request.headers.get('content-type')?.includes('multipart/form-data')) {
		try {
			const formData = await request.formData();
			const targetPageId = formData.get('targetPageId');
			const shareId = formData.get('shareId');
			const files = formData.getAll('files').filter((value): value is File => value instanceof File);
			if (typeof targetPageId !== 'string' || files.length !== formData.getAll('files').length) {
				return json({ success: false, error: 'A destination page and files are required.' }, { status: 400 });
			}
			const page = await appendSharedFilesToPage(targetPageId, files, shareId);
			return json({ success: true, pageId: page.id });
		} catch (error) {
			return json({
				success: false,
				error: error instanceof Error ? error.message : 'Could not save the shared files.'
			}, { status: error instanceof SharedContentError ? error.status : 400 });
		}
	}

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
		const input = payload as SharedContentInput & { targetPageId?: unknown };
		if (typeof input.targetPageId === 'string') {
			const page = await appendSharedLinkToPage(input.targetPageId, input);
			return json({ success: true, pageId: page.id });
		}
		const page = await createPageFromSharedContent(payload as SharedContentInput);
		return json({ success: true, pageId: page.id });
	} catch (error) {
		return json({
			success: false,
			error: error instanceof Error ? error.message : 'Could not save the shared item.'
		}, { status: error instanceof SharedContentError ? error.status : 400 });
	}
};
