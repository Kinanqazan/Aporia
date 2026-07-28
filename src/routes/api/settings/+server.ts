import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { sqlite } from '$lib/server/database';
import { shouldReplaceExpandedSidebarState } from '$lib/sidebar-state.js';

export const POST: RequestHandler = async ({ request }) => {
	const { key, value } = await request.json();
	if (!key || typeof value !== 'string') {
		return json({ success: false }, { status: 400 });
	}

	try {
		if (key === 'aporia-expanded-sidebar-pages') {
			const stored = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
				| { value: string }
				| undefined;
			if (
				stored &&
				!shouldReplaceExpandedSidebarState(stored.value, value)
			) {
				return json({ success: true, ignoredAsStale: true });
			}
		}
		sqlite.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
		return json({ success: true });
	} catch (e: any) {
		return json({ success: false, error: e.message }, { status: 500 });
	}
};
