import { Node, mergeAttributes } from '@tiptap/core';

export const Poetry = Node.create({
	name: 'poetry',
	group: 'block',
	content: 'paragraph+',
	defining: true,
	parseHTML() { return [{ tag: 'div[data-type="poetry"]' }]; },
	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'poetry' }), 0];
	}
});
