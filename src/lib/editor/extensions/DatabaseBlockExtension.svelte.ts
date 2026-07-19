import { Node } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import DatabaseBlockComponent from './DatabaseBlock.svelte';

export const DatabaseBlock = Node.create({
	name: 'databaseBlock',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			columns: {
				default: [
					{ id: 'name', name: 'Name', type: 'text' },
					{ id: 'status', name: 'Status', type: 'status' }
				]
			},
			rows: {
				default: [
					{ id: 'row-1', name: 'Task 1', status: 'Todo' },
					{ id: 'row-2', name: 'Task 2', status: 'In Progress' }
				]
			},
			options: {
				default: {
					status: ['Todo', 'In Progress', 'Done']
				}
			}
		};
	},

	parseHTML() {
		return [
			{
				tag: 'div[data-type="database-block"]'
			}
		];
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', { 'data-type': 'database-block' }];
	},

	addNodeView() {
		return ({ node, editor, getPos }) => {
			const dom = document.createElement('div');
			dom.className = 'database-block-nodeview';

			// Wrap in a Svelte 5 reactive object
			const tiptapNode = $state({
				node
			});

			const updateAttributes = (attrs: any) => {
				if (typeof getPos === 'function') {
					editor.commands.updateAttributes('databaseBlock', attrs);
				}
			};

			const svelteApp = mount(DatabaseBlockComponent, {
				target: dom,
				props: {
					tiptapNode,
					updateAttributes,
					editable: editor.isEditable
				}
			});

			return {
				dom,
				update: (updatedNode) => {
					if (updatedNode.type.name !== 'databaseBlock') {
						return false;
					}
					tiptapNode.node = updatedNode;
					return true;
				},
				destroy: () => {
					unmount(svelteApp);
				}
			};
		};
	}
});

export default DatabaseBlock;
