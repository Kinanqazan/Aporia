import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPageById, updatePage } from '$lib/server/pages';
import { validateImageReferences } from '$lib/server/assets';

function isTaskCheckboxOnlyChange(previous: unknown, next: unknown): boolean {
	let changed = false;

	const compare = (left: any, right: any): boolean => {
		if (left === right) return true;

		if (Array.isArray(left) && Array.isArray(right)) {
			return left.length === right.length && left.every((value, index) => compare(value, right[index]));
		}

		if (left && right && typeof left === 'object' && typeof right === 'object') {
			const leftKeys = Object.keys(left);
			const rightKeys = Object.keys(right);
			if (leftKeys.length !== rightKeys.length || leftKeys.some(key => !rightKeys.includes(key))) return false;

			return leftKeys.every(key => {
				if (key === 'attrs' && left.type === 'taskItem' && right.type === 'taskItem') {
					const leftAttrs = left.attrs;
					const rightAttrs = right.attrs;
					if (!leftAttrs || !rightAttrs || typeof leftAttrs !== 'object' || typeof rightAttrs !== 'object') {
						return false;
					}

					const leftAttrKeys = Object.keys(leftAttrs);
					const rightAttrKeys = Object.keys(rightAttrs);
					if (leftAttrKeys.length !== rightAttrKeys.length || leftAttrKeys.some(attr => !rightAttrKeys.includes(attr))) {
						return false;
					}

					return leftAttrKeys.every(attr => {
						if (attr === 'checked') {
							if (leftAttrs.checked !== rightAttrs.checked) changed = true;
							return true;
						}
						return compare(leftAttrs[attr], rightAttrs[attr]);
					});
				}
				return compare(left[key], right[key]);
			});
		}

		return false;
	};

	return compare(previous, next) && changed;
}

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
		const page = await updatePage(id, { contentJson });
		if (!page) {
			return json({ success: false, error: 'Page not found' }, { status: 404 });
		}
		
		return json({ success: true });
	} catch (err: any) {
		return json({ success: false, error: err.message }, { status: 500 });
	}
};
