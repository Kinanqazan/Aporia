import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { beginUploadActivity, finishUploadActivity, renewUploadActivity, UploadActivityError } from '$lib/server/upload-activity';

export const POST: RequestHandler = async ({ request, url }) => {
	const origin = request.headers.get('origin');
	if (origin && origin !== url.origin) return json({ success: false, error: 'Invalid request origin' }, { status: 403 });
	try {
		const payload = await request.json();
		if (payload?.action === 'start') return json({ success: true, id: beginUploadActivity() });
		if (typeof payload?.id !== 'string' || payload.id.length > 64 || !payload.id) {
			return json({ success: false, error: 'An upload session is required' }, { status: 400 });
		}
		if (payload.action === 'renew') renewUploadActivity(payload.id);
		else if (payload.action === 'finish') finishUploadActivity(payload.id);
		else return json({ success: false, error: 'Invalid upload session action' }, { status: 400 });
		return json({ success: true });
	} catch (error) {
		return json({ success: false, error: error instanceof Error ? error.message : 'Unable to coordinate upload' },
			{ status: error instanceof UploadActivityError ? error.status : error instanceof SyntaxError ? 400 : 500 });
	}
};
