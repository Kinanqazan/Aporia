import { createWorkspaceBackup } from '$lib/server/backup';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const zipBytes = await createWorkspaceBackup();
	const dateStr = new Date().toISOString().slice(0, 10);
	const filename = `aporia_backup_${dateStr}.aporia.zip`;

	return new Response(zipBytes as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
};
