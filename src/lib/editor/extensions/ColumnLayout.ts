import { Node, mergeAttributes } from '@tiptap/core';

/**
 * ColumnLayout node — a flex row container that holds 2-5 Column children.
 * Rendered as `<div class="column-layout">` with display:flex.
 */
export const ColumnLayout = Node.create({
	name: 'columnLayout',

	group: 'block',

	content: 'column{2,5}',

	defining: true,

	isolating: true,

	parseHTML() {
		return [{ tag: 'div[data-type="columnLayout"]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, {
				'data-type': 'columnLayout',
				class: 'column-layout'
			}),
			0
		];
	}
});

export default ColumnLayout;
