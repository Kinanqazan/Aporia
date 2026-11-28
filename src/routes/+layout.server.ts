import type { LayoutServerLoad } from './$types';
import { getActivePages, getTrashPages } from '$lib/server/pages';
import { sqlite } from '$lib/server/database';
import { parseExpandedSidebarState } from '$lib/sidebar-state.js';
import { pageVersion } from '$lib/server/mcp/versions';
import { getUsername, hasValidSession, SESSION_COOKIE_NAME } from '$lib/server/auth';
import { normalizeIconColor } from '$lib/icon-colors';

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
	
	const editorTextSizes: Record<string, number> = {};
	const sidebarFolderPageIds: string[] = [];
	const sidebarTitleColors: Record<string, string> = {};
	let defaultPageId = '';
	let defaultSharePageId = '';
	let startupMode: 'default' | 'last' = 'default';
	try {
		const startupSetting = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('aporia-startup-mode') as { value: string } | undefined;
		if (startupSetting?.value === 'last') startupMode = 'last';
		const defaultPage = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('aporia-default-page') as { value: string } | undefined;
		if (defaultPage && activePageIds.has(defaultPage.value)) defaultPageId = defaultPage.value;
		const defaultSharePage = sqlite.prepare('SELECT value FROM settings WHERE key = ?').get('aporia-default-share-page') as { value: string } | undefined;
		if (defaultSharePage && activePageIds.has(defaultSharePage.value)) defaultSharePageId = defaultSharePage.value;
		const colors = sqlite.prepare("SELECT key, value FROM settings WHERE key LIKE 'aporia-sidebar-title-color:%'").all() as Array<{ key: string; value: string }>;
		for (const setting of colors) {
			const id = setting.key.slice('aporia-sidebar-title-color:'.length);
			const color = normalizeIconColor(setting.value);
			if (activePageIds.has(id) && color) sidebarTitleColors[id] = color;
		}
		const folders = sqlite.prepare("SELECT key FROM settings WHERE key LIKE 'aporia-sidebar-folder:%' AND value = '1'").all() as Array<{ key: string }>;
		for (const folder of folders) {
			const id = folder.key.slice('aporia-sidebar-folder:'.length);
			if (activePageIds.has(id)) sidebarFolderPageIds.push(id);
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
		username: hasValidSession(cookies.get(SESSION_COOKIE_NAME)) ? getUsername() : undefined,
		activePages: activePages.map((page) => ({ ...page, version: pageVersion(page.revision) })),
		trashPages: trashPages.map((page) => ({ ...page, version: pageVersion(page.revision) })),
		sidebarWidth,
		isDarkMode,
		expandedSidebarPageIds,
		expandedSidebarStateUpdatedAt,
		hasExpandedSidebarState,
		editorTextSizes,
		sidebarFolderPageIds,
		sidebarTitleColors,
		defaultPageId,
		defaultSharePageId,
		startupMode
	};
};
