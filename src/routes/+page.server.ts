import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getActivePages, getTrashPages, createPage, sendToTrash, restoreFromTrash, deletePermanently, emptyTrash, movePage, updatePage } from '$lib/server/pages';

export const load: PageServerLoad = async () => {
	const active = await getActivePages();
	if (active.length > 0) {
		// Automatically redirect to the first active document
		throw redirect(307, `/${active[0].id}`);
	}
	return {
		isEmptyWorkspace: true
	};
};

export const actions: Actions = {
	create: async ({ request }) => {
		const data = await request.formData();
		const parentIdStr = data.get('parentId') as string | null;
		const title = (data.get('title') as string) || 'Untitled';
		const icon = data.get('icon') as string | null;
		const parentId = parentIdStr && parentIdStr !== 'null' ? parseInt(parentIdStr, 10) : null;

		let page;
		try {
			page = await createPage(parentId, title, icon);
		} catch (err: any) {
			return fail(500, { message: err.message });
		}

		throw redirect(303, `/${page.id}`);
	},
	rename: async ({ request }) => {
		const data = await request.formData();
		const idStr = data.get('id') as string;
		const title = data.get('title') as string;
		const id = parseInt(idStr, 10);

		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		try {
			const page = await updatePage(id, { title });
			return { success: true, page };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	move: async ({ request }) => {
		const data = await request.formData();
		const id = parseInt(data.get('id') as string, 10);
		const parentIdValue = data.get('parentId') as string | null;
		const parentId = parentIdValue && parentIdValue !== 'null' ? parseInt(parentIdValue, 10) : null;
		const position = parseInt(data.get('position') as string, 10);

		if (isNaN(id) || (parentId !== null && isNaN(parentId)) || isNaN(position) || position < 0) {
			return fail(400, { message: 'Invalid page move' });
		}

		try {
			const moved = await movePage(id, parentId, position);
			if (!moved) return fail(400, { message: 'Invalid page move' });
			return { success: true };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	updateIcon: async ({ request }) => {
		const data = await request.formData();
		const idStr = data.get('id') as string;
		const icon = data.get('icon') as string | null;
		const id = parseInt(idStr, 10);

		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		try {
			const page = await updatePage(id, { icon });
			return { success: true, page };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	trash: async ({ request }) => {
		const data = await request.formData();
		const idStr = data.get('id') as string;
		const id = parseInt(idStr, 10);

		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		try {
			await sendToTrash(id);
			return { success: true };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	restore: async ({ request }) => {
		const data = await request.formData();
		const idStr = data.get('id') as string;
		const id = parseInt(idStr, 10);

		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		try {
			await restoreFromTrash(id);
			return { success: true };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	delete: async ({ request }) => {
		const data = await request.formData();
		const idStr = data.get('id') as string;
		const id = parseInt(idStr, 10);

		if (isNaN(id)) return fail(400, { message: 'Invalid page ID' });

		try {
			await deletePermanently(id);
			return { success: true };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	},
	emptyTrash: async () => {
		try {
			await emptyTrash();
			return { success: true };
		} catch (err: any) {
			return fail(500, { message: err.message });
		}
	}
};
