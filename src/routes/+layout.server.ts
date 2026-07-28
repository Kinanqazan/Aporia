import type { LayoutServerLoad } from './$types';
import { getActivePages, getTrashPages } from '$lib/server/pages';
import { sqlite } from '$lib/server/database';
import { parseExpandedSidebarState } from '$lib/sidebar-state.js';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const activePages = await getActivePages();
	const trashPages = await getTrashPages();
	const sidebarWidthStr = cookies.get('sidebar-width');
	const sidebarWidth = sidebarWidthStr ? parseInt(sidebarWidthStr, 10) : 240;
	const isDarkMode = cookies.get('theme') === 'dark';
	const expandedSidebarCookie = cookies.get('aporia-expanded-sidebar-pages');
	let expandedSidebarPageIds: string[] = [];
	let expandedSidebarStateUpdatedAt = 0;
	let hasExpandedSidebarState = false;
	const activePageIds = new Set(activePages.map((page) => page.id));
	
	let sectionTitle = 'Private';
	const editorTextSizes: Record<string, number> = {};
	try {
		const row = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('sidebar-section-title') as { value: string } | undefined;
		if (row) {
			sectionTitle = row.value;
		}

		const expandedSidebarRow = sqlite
			.prepare('SELECT value FROM settings WHERE key = ?')
			.get('aporia-expanded-sidebar-pages') as { value: string } | undefined;
		if (expandedSidebarRow) {
			hasExpandedSidebarState = true;
			const expandedSidebarState = parseExpandedSidebarState(
				expandedSidebarRow.value,
				activePageIds
			);
			expandedSidebarPageIds = expandedSidebarState.ids;
			expandedSidebarStateUpdatedAt = expandedSidebarState.updatedAt;
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
		console.error('Failed to load layout settings:', e);
	}

	const cookieExpandedSidebarState = parseExpandedSidebarState(expandedSidebarCookie, activePageIds);
	if (cookieExpandedSidebarState.updatedAt > expandedSidebarStateUpdatedAt) {
		hasExpandedSidebarState = true;
		expandedSidebarPageIds = cookieExpandedSidebarState.ids;
		expandedSidebarStateUpdatedAt = cookieExpandedSidebarState.updatedAt;
	}

	return {
		activePages,
		trashPages,
		sidebarWidth,
		isDarkMode,
		expandedSidebarPageIds,
		expandedSidebarStateUpdatedAt,
		hasExpandedSidebarState,
		sectionTitle,
		editorTextSizes
	};
};
