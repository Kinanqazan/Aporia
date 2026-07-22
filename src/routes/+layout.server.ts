import type { LayoutServerLoad } from './$types';
import { getActivePages, getTrashPages } from '$lib/server/pages';
import { sqlite } from '$lib/server/database';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const activePages = await getActivePages();
	const trashPages = await getTrashPages();
	const sidebarWidthStr = cookies.get('sidebar-width');
	const sidebarWidth = sidebarWidthStr ? parseInt(sidebarWidthStr, 10) : 240;
	
	let sectionTitle = 'Private';
	const editorTextSizes: Record<string, number> = {};
	try {
		const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('sidebar-section-title') as { value: string } | undefined;
		if (row) {
			sectionTitle = row.value;
		}

		const rows = sqlite
			.prepare("SELECT key, value FROM settings WHERE key LIKE 'aporia-editor-text-size:%'")
			.all() as Array<{ key: string; value: string }>;
		for (const setting of rows) {
			const pageId = setting.key.slice('aporia-editor-text-size:'.length);
			const size = Number(setting.value);
			if (pageId && [14, 16, 18, 20].includes(size)) {
				editorTextSizes[pageId] = size;
			}
		}
	} catch (e) {
		console.error('Failed to load section title setting:', e);
	}

	return {
		activePages,
		trashPages,
		sidebarWidth,
		sectionTitle,
		editorTextSizes
	};
};
