import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getPageById, updatePage } from '$lib/server/pages';

export const load: PageServerLoad = async ({ params }) => {
	const id = params.id;
	if (!id) throw error(400, 'Invalid page ID');

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
		const id = params.id;
		if (!id) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const title = data.get('title') as string;
		const page = await getPageById(id);
		if (page?.isLocked) return fail(423, { message: 'This page is locked' });

		try {
			const pageRecord = await updatePage(id, { title });
			return { success: true, pageRecord };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	changeIcon: async ({ params, request }) => {
		const id = params.id;
		if (!id) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const icon = data.get('icon') as string | null;
		const page = await getPageById(id);
		if (page?.isLocked) return fail(423, { message: 'This page is locked' });

		try {
			const pageRecord = await updatePage(id, { icon });
			return { success: true, pageRecord };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	toggleLock: async ({ params, request }) => {
		const id = params.id;
		if (!id) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const isLocked = data.get('isLocked') === 'true';
		try {
			const pageRecord = await updatePage(id, { isLocked: isLocked ? 1 : 0 });
			if (!pageRecord) return fail(404, { message: 'Page not found' });
			return { success: true, pageRecord };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	}
};
