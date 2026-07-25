import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePageContentConditionally } from '$lib/server/pages';
import { validateImageReferences } from '$lib/server/assets';
import { isTaskCheckboxOnlyChange } from '$lib/server/task-checkbox-change.js';

export const POST: RequestHandler = async ({ params, request }) => {
	const id = params.id;
	if (!id) {
		return json({ success: false, error: 'Invalid page ID' }, { status: 400 });
	}

	try {
		const { contentJson } = await request.json();
		if (typeof contentJson !== 'string') {
			return json({ success: false, error: 'contentJson must be a string' }, { status: 400 });
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
		
		// Update the contentJson field in the database
		const existingPage = await getPageById(id);
		if (!existingPage) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
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
		const page = await updatePageContentConditionally(id, contentJson, {
			isLocked: existingPage.isLocked,
			contentJson: existingPage.contentJson
		});
		if (!page) {
			const currentPage = await getPageById(id);
			if (!currentPage) {
				return json({ success: false, error: 'Page not found' }, { status: 404 });
			}
			if (currentPage.isLocked && !existingPage.isLocked) {
				return json({ success: false, error: 'Page was locked while saving' }, { status: 423 });
			}
			return json({ success: false, error: 'Page changed while saving' }, { status: 409 });
		}
		
		return json({ success: true });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
