import { Node, mergeAttributes } from '@tiptap/core';

/**
 * Column node — a wrapper that holds block content inside a ColumnLayout.
 * Rendered as a `<div class="column">` with flexible width.
 */
export const Column = Node.create({
	name: 'column',

	content: 'block+',

	defining: true,

	isolating: true,

	addAttributes() {
		return {
			width: {
				default: null,
				parseHTML: (element) => element.getAttribute('data-col-width'),
				renderHTML: (attributes) => {
					const attrs: Record<string, string> = {};
					if (attributes.width) {
						attrs['data-col-width'] = attributes.width;
						attrs.style = `width: ${attributes.width}%`;
					}
					return attrs;
				}
			}
		};
	},

	parseHTML() {
		return [{ tag: 'div[data-type="column"]' }];
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'div',
			mergeAttributes(HTMLAttributes, {
				'data-type': 'column',
				class: 'column'
			}),
			0
		];
	}
});

export default Column;
