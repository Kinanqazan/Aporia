import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getPageById, updatePageAtVersion } from '$lib/server/pages';
import { pageVersion } from '$lib/server/mcp/versions';

export const load: PageServerLoad = async ({ params }) => {
	const id = params.id;
	if (!id) throw error(400, 'Invalid page ID');

	const pageRecord = await getPageById(id);
	if (!pageRecord || pageRecord.isInTrash === 1) {
		throw error(404, 'Page not found');
	}

	return { pageRecord: { ...pageRecord, version: pageVersion(pageRecord.revision) } };
};

export const actions: Actions = {
	renamePage: async ({ params, request }) => {
		const id = params.id;
		if (!id) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const title = data.get('title') as string;
		const expectedVersion = data.get('expectedVersion') as string;
		const page = await getPageById(id);
		if (page?.isLocked) return fail(423, { message: 'This page is locked' });
		if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before saving.' });

		try {
			const pageRecord = await updatePageAtVersion(id, expectedVersion, { title });
			if (!pageRecord) return fail(409, { message: 'Page changed. Reload it before saving.' });
			return { success: true, pageRecord: { ...pageRecord, version: pageVersion(pageRecord.revision) } };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	changeIcon: async ({ params, request }) => {
		const id = params.id;
		if (!id) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const icon = data.get('icon') as string | null;
		const iconColor = data.get('iconColor') as string | null;
		const expectedVersion = data.get('expectedVersion') as string;
		const page = await getPageById(id);
		if (page?.isLocked) return fail(423, { message: 'This page is locked' });
		if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before saving.' });

		try {
			const pageRecord = await updatePageAtVersion(id, expectedVersion, { icon, iconColor });
			if (!pageRecord) return fail(409, { message: 'Page changed. Reload it before saving.' });
			return { success: true, pageRecord: { ...pageRecord, version: pageVersion(pageRecord.revision) } };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	toggleLock: async ({ params, request }) => {
		const id = params.id;
		if (!id) return fail(400, { message: 'Invalid page ID' });

		const data = await request.formData();
		const isLocked = data.get('isLocked') === 'true';
		const expectedVersion = data.get('expectedVersion') as string;
		if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before changing the lock.' });
		try {
			const pageRecord = await updatePageAtVersion(id, expectedVersion, { isLocked: isLocked ? 1 : 0 });
			if (!pageRecord) return fail(409, { message: 'Page changed. Reload before changing the lock.' });
			return { success: true, pageRecord: { ...pageRecord, version: pageVersion(pageRecord.revision) } };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	}
};
