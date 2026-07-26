import { restoreWorkspaceBackup } from '$lib/server/backup';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const formData = await request.formData();
		const file = formData.get('file');

		if (!(file instanceof File)) {
			return json({ success: false, error: 'A valid backup ZIP file is required' }, { status: 400 });
		}

		const buffer = await file.arrayBuffer();
		const result = await restoreWorkspaceBackup(buffer);

		return json({
			success: true,
			message: `Workspace restored successfully (${result.pageCount} pages, ${result.assetCount} assets)`
		});
	} catch (err: any) {
		return json(
			{
				success: false,
				error: err?.message || 'Failed to restore backup'
			},
			{ status: 400 }
		);
	}
};
