import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getPageById, updatePage } from '$lib/server/pages';

export const load: PageServerLoad = async ({ params }) => {
	const id = parseInt(params.id, 10);
	if (isNaN(id)) throw error(400, 'Invalid page ID');

	const pageRecord = await getPageById(id);
	if (!pageRecord || pageRecord.isInTrash === 1) {
		throw error(404, 'Page not found');
	}

	return {
		pageRecord
	};
};

export const actions: Actions = {
	renamePage: async ({ params, request }) => {
		const id = parseInt(params.id, 10);
		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const title = data.get('title') as string;

		try {
			const pageRecord = await updatePage(id, { title });
			return { success: true, pageRecord };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	changeIcon: async ({ params, request }) => {
		const id = parseInt(params.id, 10);
		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const icon = data.get('icon') as string | null;

		try {
			const pageRecord = await updatePage(id, { icon });
			return { success: true, pageRecord };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	}
};
