import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sqlite } from '$lib/server/database';

export const POST: RequestHandler = async ({ request }) => {
	const { key, value } = await request.json();
	if (!key || typeof value !== 'string') {
		return json({ success: false }, { status: 400 });
	}

	try {
		sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
		return json({ success: true });
	} catch (e: any) {
		return json({ success: false, error: e.message }, { status: 500 });
	}
};
