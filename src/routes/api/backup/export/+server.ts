import { createWorkspaceBackup } from '$lib/server/backup';
import { UploadActivityError } from '$lib/server/upload-activity';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	let zipBytes: Uint8Array;
	try {
		zipBytes = await createWorkspaceBackup();
	} catch (error) {
		if (error instanceof UploadActivityError) return json({ success: false, error: error.message }, { status: error.status });
		throw error;
	}
	const dateStr = new Date().toISOString().slice(0, 10);
	const filename = `aporia_backup_${dateStr}.aporia.zip`;

	return new Response(zipBytes as unknown as BodyInit, {
		headers: {
			'Content-Type': 'application/zip',
			'Content-Disposition': `attachment; filename="${filename}"`
		}
	});
};
