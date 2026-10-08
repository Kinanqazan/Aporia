import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePageAtVersion } from '$lib/server/pages';
import { pageVersion } from '$lib/server/mcp/versions';

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
		if (typeof body?.expectedVersion !== 'string') return json({ success: false, error: 'expectedVersion is required' }, { status: 400 });

		const existingPage = await getPageById(id);
		if (!existingPage || existingPage.isInTrash) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}
		const page = await updatePageAtVersion(id, body.expectedVersion, { isFullWidth: body.isFullWidth ? 1 : 0 });
		if (!page) {
			return json({ success: false, error: 'Page changed; reload before changing its layout', conflict: true }, { status: 409 });
		}

		return json({ success: true, isFullWidth: page.isFullWidth === 1, version: pageVersion(page.revision) });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
