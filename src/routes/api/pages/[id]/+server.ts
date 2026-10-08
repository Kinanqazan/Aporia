import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePageContentAtVersion } from '$lib/server/pages';
import { validateImageReferences } from '$lib/server/assets';
import { isTaskCheckboxOnlyChange } from '$lib/server/task-checkbox-change.js';
import { validateEditorDocument } from '$lib/server/mcp/document';
import { pageVersion } from '$lib/server/mcp/versions';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) {
		return json({ success: false, error: 'Invalid page ID' }, { status: 400 });
	}

	try {
		const { contentJson, expectedVersion } = await request.json();
		if (typeof contentJson !== 'string') {
			return json({ success: false, error: 'contentJson must be a string' }, { status: 400 });
		}
		if (typeof expectedVersion !== 'string' || !expectedVersion) {
			return json({ success: false, error: 'expectedVersion is required' }, { status: 400 });
		}

		let documentContent: unknown;
		try {
			documentContent = JSON.parse(contentJson);
			if ((documentContent as { type?: string })?.type !== 'doc') {
				return json({ success: false, error: 'contentJson must be a Tiptap document' }, { status: 400 });
			}
		} catch {
			return json({ success: false, error: 'contentJson must be valid JSON' }, { status: 400 });
		}

		const imageReferenceError = await validateImageReferences(documentContent);
		if (imageReferenceError) {
			return json({ success: false, error: imageReferenceError }, { status: 400 });
		}
		const documentError = validateEditorDocument(documentContent);
		if (documentError) return json({ success: false, error: documentError }, { status: 400 });
		
		// Update the contentJson field in the database
		const existingPage = await getPageById(id);
		if (!existingPage) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}
		if (existingPage.isInTrash) {
			return json({ success: false, error: 'Page is in Trash', conflict: true, currentVersion: pageVersion(existingPage.revision) }, { status: 409 });
		}
		if (existingPage.isLocked) {
			let previousContent: unknown;
			try {
				previousContent = existingPage.contentJson ? JSON.parse(existingPage.contentJson) : null;
			} catch {
				return json({ success: false, error: 'Page content is invalid' }, { status: 500 });
			}

			if (!isTaskCheckboxOnlyChange(previousContent, documentContent)) {
				return json({ success: false, error: 'Page is locked' }, { status: 423 });
			}
		}
		const page = await updatePageContentAtVersion(id, contentJson, expectedVersion, {
			isLocked: existingPage.isLocked,
			contentJson: existingPage.contentJson
		});
		if (!page) {
			const currentPage = await getPageById(id);
			if (!currentPage || currentPage.isInTrash) {
				return json({ success: false, error: 'Page not found' }, { status: 404 });
			}
			if (currentPage.isLocked && !existingPage.isLocked) {
				return json({ success: false, error: 'Page was locked while saving' }, { status: 423 });
			}
			return json({ success: false, error: 'Page changed while saving', conflict: true, currentVersion: pageVersion(currentPage.revision) }, { status: 409 });
		}
		
		return json({ success: true, version: pageVersion(page.revision) });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
