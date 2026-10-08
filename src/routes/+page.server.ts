import { redirect, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { getActivePages, seedDemoWorkspace, createPage, deletePermanently, emptyTrash } from '$lib/server/pages';
import { updatePageAtVersion } from '$lib/server/pages';
import { moveMcpPage, restoreMcpPage, trashMcpPage } from '$lib/server/mcp/page-operations';

function mutationFailure(error: any) {
	const status = error?.code === 'CONFLICT' ? 409 : error?.code === 'LOCKED' ? 423 : error?.code === 'NOT_FOUND' ? 404 : 400;
	return fail(status, { message: error?.message || 'Page operation failed.' });
}

export const load: PageServerLoad = async () => {
	let active = await getActivePages();
	if (active.length === 0) {
		active = await seedDemoWorkspace();
	}
	if (active.length > 0) {
		// Automatically redirect to the first active document (Getting Started)
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
		const iconColor = data.get('iconColor') as string | null;
		const parentId = parentIdStr && parentIdStr !== 'null' ? parentIdStr : null;

		let page;
		try {
			page = await createPage(parentId, title, icon, iconColor);
		} catch (err: any) {
			return fail(500, { message: err.message });
		}

		throw redirect(303, `/${page.id}`);
	},
	seedDemo: async () => {
		const active = await seedDemoWorkspace();
		if (active.length > 0) {
			throw redirect(303, `/${active[0].id}`);
		}
		throw redirect(303, '/');
	},
	rename: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const title = data.get('title') as string;
		const expectedVersion = data.get('expectedVersion') as string;

		if (!id) return fail(400, { message: 'Invalid page ID' });

		try {
			if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before saving.' });
			const page = await updatePageAtVersion(id, expectedVersion, { title });
			if (!page) return fail(409, { message: 'Page changed. Reload before saving.' });
			return { success: true, page };
		} catch (err: any) {
			return mutationFailure(err);
		}
	},
	move: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const parentIdValue = data.get('parentId') as string | null;
		const parentId = parentIdValue && parentIdValue !== 'null' ? parentIdValue : null;
		const position = parseInt(data.get('position') as string, 10);
		const expectedVersion = data.get('expectedVersion') as string;

		if (!id || !expectedVersion || isNaN(position) || position < 0) {
			return fail(400, { message: 'Invalid page move' });
		}

		try {
			moveMcpPage({ id, parentId, position, expectedVersion });
			return { success: true };
		} catch (err: any) {
			return mutationFailure(err);
		}
	},
	updateIcon: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const icon = data.get('icon') as string | null;
		const iconColor = data.get('iconColor') as string | null;
		const expectedVersion = data.get('expectedVersion') as string;

		if (!id) return fail(400, { message: 'Invalid page ID' });

		try {
			if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before saving.' });
			const page = await updatePageAtVersion(id, expectedVersion, { icon, iconColor });
			if (!page) return fail(409, { message: 'Page changed. Reload before saving.' });
			return { success: true, page };
		} catch (err: any) {
			return mutationFailure(err);
		}
	},
	trash: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const returnToWorkspace = data.get('returnToWorkspace') === 'true';
		const expectedVersion = data.get('expectedVersion') as string;

		if (!id) return fail(400, { message: 'Invalid page ID' });

		let trashed: boolean;
		try {
			if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before moving it to Trash.' });
			trashMcpPage({ id, expectedVersion });
			trashed = true;
		} catch (err: any) {
			return mutationFailure(err);
		}
		if (!trashed) return fail(404, { message: 'Page not found' });
		if (returnToWorkspace) throw redirect(303, '/');
		return { success: true };
	},
	restore: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;
		const expectedVersion = data.get('expectedVersion') as string;

		if (!id) return fail(400, { message: 'Invalid page ID' });

		try {
			if (!expectedVersion) return fail(400, { message: 'Page version is required; reload before restoring.' });
			restoreMcpPage({ id, expectedVersion });
			return { success: true };
		} catch (err: any) {
			return mutationFailure(err);
		}
	},
	delete: async ({ request }) => {
		const data = await request.formData();
		const id = data.get('id') as string;

		if (!id) return fail(400, { message: 'Invalid page ID' });

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
