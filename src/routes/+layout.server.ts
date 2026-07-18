import type { LayoutServerLoad } from './$types';
import { getActivePages, getTrashPages } from '$lib/server/pages';
import { sqlite } from '$lib/server/database';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const activePages = await getActivePages();
	const trashPages = await getTrashPages();
	const sidebarWidthStr = cookies.get('sidebar-width');
	const sidebarWidth = sidebarWidthStr ? parseInt(sidebarWidthStr, 10) : 240;
	
	let sectionTitle = 'Private';
	try {
		const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('sidebar-section-title') as { value: string } | undefined;
		if (row) {
			sectionTitle = row.value;
		}
	} catch (e) {
		console.error('Failed to load section title setting:', e);
	}

	return {
		activePages,
		trashPages,
		sidebarWidth,
		sectionTitle
	};
};
