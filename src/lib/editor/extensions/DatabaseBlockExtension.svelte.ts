import { Node } from '@tiptap/core';
import { mount, unmount } from 'svelte';
import DatabaseBlockComponent from './DatabaseBlock.svelte';
import { normalizeDatabaseAttributes } from '$lib/editor/database-model';

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
					{ id: 'row-1', name: '', status: '' },
					{ id: 'row-2', name: '', status: '' }
				]
			},
			options: {
				default: {
					status: ['Todo', 'In Progress', 'Done']
				}
			},
			showSummary: {
				default: false
			},
			summary: {
				default: {}
			},
			sort: {
				default: null
			}
		};
	},

	parseHTML() {
		return [
			{
				tag: 'div[data-type="database-block"]',
				getAttrs: element => {
					const read = (name: string, fallback: unknown) => {
						try {
							const value = element.getAttribute(name);
							return value ? JSON.parse(value) : fallback;
						} catch {
							return fallback;
						}
					};
					return {
						columns: read('data-columns', undefined),
						rows: read('data-rows', undefined),
						options: read('data-options', undefined),
						showSummary: read('data-show-summary', false),
						summary: read('data-summary', {}),
						sort: read('data-sort', null)
					};
				}
			}
		];
	},

	renderHTML({ node }) {
		return ['div', {
			'data-type': 'database-block',
			'data-columns': JSON.stringify(node.attrs.columns || []),
			'data-rows': JSON.stringify(node.attrs.rows || []),
			'data-options': JSON.stringify(node.attrs.options || {}),
			'data-show-summary': JSON.stringify(node.attrs.showSummary === true),
			'data-summary': JSON.stringify(node.attrs.summary || {}),
			'data-sort': JSON.stringify(node.attrs.sort || null)
		}];
	},

	addNodeView() {
		return ({ node, editor, getPos }) => {
			const dom = document.createElement('div');
			dom.className = 'database-block-nodeview';

			// Wrap in a Svelte 5 reactive object
			const tiptapNode = $state({
				node,
				editable: editor.isEditable
			});

			const updateAttributes = (attrs: Record<string, unknown>): boolean => {
				if (!editor.isEditable || typeof getPos !== 'function') return false;
				const pos = getPos();
				if (typeof pos !== 'number') return false;
				const currentNode = editor.state.doc.nodeAt(pos);
				if (!currentNode || currentNode.type.name !== 'databaseBlock') return false;
				const nextAttrs = normalizeDatabaseAttributes({ ...currentNode.attrs, ...attrs });
				const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
					...currentNode.attrs,
					...nextAttrs
				});
				editor.view.dispatch(tr);
				return true;
			};

			const syncEditable = () => {
				tiptapNode.editable = editor.isEditable;
			};
			editor.on('update', syncEditable);

			const svelteApp = mount(DatabaseBlockComponent, {
				target: dom,
				props: {
					tiptapNode,
					updateAttributes,
					get editable() { return tiptapNode.editable; }
				}
			});

			return {
				dom,
				update: (updatedNode) => {
					if (updatedNode.type.name !== 'databaseBlock') {
						return false;
					}
					tiptapNode.node = updatedNode;
					tiptapNode.editable = editor.isEditable;
					return true;
				},
				stopEvent: (event: Event) => {
					const target = event.target as HTMLElement | null;
					return !!target?.closest('input, select, textarea, button, [role="menuitem"], [data-database-resize-handle]');
				},
				ignoreMutation: () => true,
				destroy: () => {
					editor.off('update', syncEditable);
					unmount(svelteApp);
				}
			};
		};
	}
});

export default DatabaseBlock;
