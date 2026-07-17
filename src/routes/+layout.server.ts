import type { LayoutServerLoad } from './$types';
import { getActivePages, getTrashPages } from '$lib/server/pages';

export const load: LayoutServerLoad = async () => {
	const activePages = await getActivePages();
	const trashPages = await getTrashPages();

	return {
		activePages,
		trashPages
	};
};
