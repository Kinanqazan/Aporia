import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Plugin, PluginKey, Selection, TextSelection } from '@tiptap/pm/state';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';

/**
 * Safely removes a taskItem node from the document without breaking or splitting parent taskList.
 */
function deleteTaskItem(editor: any, taskItemDepth: number): boolean {
	const { state, view } = editor;
	const { selection } = state;
	const { $from } = selection;

	const taskItemPos = $from.before(taskItemDepth);
	const taskItemNode = $from.node(taskItemDepth);

	const parentListDepth = taskItemDepth - 1;
	const parentList = $from.node(parentListDepth);

	const tr = state.tr;

	if (parentList && parentList.type.name === 'taskList' && parentList.childCount === 1) {
		const listPos = $from.before(parentListDepth);
		const listEndPos = listPos + parentList.nodeSize;
		const paragraphType = state.schema.nodes.paragraph;

		if (paragraphType) {
			const newParagraph = paragraphType.create();
			tr.replaceWith(listPos, listEndPos, newParagraph);
			const resolvedPos = Math.min(listPos + 1, tr.doc.content.size);
			tr.setSelection(TextSelection.create(tr.doc, resolvedPos));
		} else {
			tr.delete(listPos, listEndPos);
		}
	} else {
		tr.delete(taskItemPos, taskItemPos + taskItemNode.nodeSize);

		const targetPos = Math.max(1, taskItemPos - 1);
		try {
			const resolved = tr.doc.resolve(targetPos);
			tr.setSelection(Selection.near(resolved, -1));
		} catch (e) {
			// Fallback if resolve fails
		}
	}

	view.dispatch(tr);
	return true;
}

/**
 * Extended TaskItem extension that ensures checkbox checking works identically
 * and reliably in BOTH Edit Mode and Locked/Read-Only Mode without stale node references.
 */
export const EnhancedTaskItem = TaskItem.extend({
	addKeyboardShortcuts() {
		return {
			Enter: ({ editor }) => {
				const { selection } = editor.state;
				if (!selection.empty) return false;

				const { $from } = selection;

				let taskItemDepth = -1;
				for (let d = $from.depth; d > 0; d--) {
					if ($from.node(d).type.name === this.name) {
						taskItemDepth = d;
						break;
					}
				}

				if (taskItemDepth === -1) return false;

				const taskItemNode = $from.node(taskItemDepth);
				const isEmpty = taskItemNode.textContent.trim().length === 0;

				if (isEmpty) {
					const parentListDepth = taskItemDepth - 1;
					const parentList = $from.node(parentListDepth);

					if (parentList && parentList.type.name === 'taskList') {
						const indexInList = $from.index(parentListDepth);
						const isLast = indexInList === parentList.childCount - 1;

						if (isLast) {
							// Exit list cleanly by placing a paragraph AFTER the single taskList
							const listPos = $from.before(parentListDepth);
							const listEndPos = listPos + parentList.nodeSize;
							const paragraphType = editor.schema.nodes.paragraph;

							if (paragraphType) {
								const tr = editor.state.tr;
								const itemPos = $from.before(taskItemDepth);
								tr.delete(itemPos, itemPos + taskItemNode.nodeSize);

								const newParagraph = paragraphType.create();
								const targetPos = listEndPos - taskItemNode.nodeSize;
								tr.insert(targetPos, newParagraph);

								const resolvedPos = Math.min(targetPos + 1, tr.doc.content.size);
								tr.setSelection(TextSelection.create(tr.doc, resolvedPos));

								editor.view.dispatch(tr);
								return true;
							}
						} else {
							// In middle of list: create a new taskItem below without splitting taskList into two
							const itemPos = $from.before(taskItemDepth);
							const nextPos = itemPos + taskItemNode.nodeSize;
							const newTaskItem = editor.schema.nodes.taskItem.createAndFill({ checked: false });

							if (newTaskItem) {
								const tr = editor.state.tr.insert(nextPos, newTaskItem);
								const focusPos = Math.min(nextPos + 2, tr.doc.content.size);
								tr.setSelection(TextSelection.create(tr.doc, focusPos));
								editor.view.dispatch(tr);
								return true;
							}
						}
					}
				}

				return this.editor.commands.splitListItem(this.name);
			},
			Backspace: ({ editor }) => {
				const { selection } = editor.state;
				if (!selection.empty) return false;

				const { $from } = selection;

				let taskItemDepth = -1;
				for (let d = $from.depth; d > 0; d--) {
					if ($from.node(d).type.name === this.name) {
						taskItemDepth = d;
						break;
					}
				}

				if (taskItemDepth === -1) return false;

				// Cursor is at start of content inside taskItem if parentOffset === 0 and index in taskItem === 0
				const isAtStartOfTaskItem = $from.parentOffset === 0 && $from.index(taskItemDepth) === 0;

				if (isAtStartOfTaskItem) {
					const taskItemNode = $from.node(taskItemDepth);
					const isEmpty = taskItemNode.textContent.trim().length === 0;

					if (isEmpty) {
						return deleteTaskItem(editor, taskItemDepth);
					}

					if (editor.commands.joinBackward()) {
						return true;
					}

					// Return true to prevent default lift behavior which splits taskList into two
					return true;
				}

				return false;
			},
			Delete: ({ editor }) => {
				const { selection } = editor.state;
				if (!selection.empty) return false;

				const { $from } = selection;
				let taskItemDepth = -1;
				for (let d = $from.depth; d > 0; d--) {
					if ($from.node(d).type.name === this.name) {
						taskItemDepth = d;
						break;
					}
				}

				if (taskItemDepth === -1) return false;

				const taskItemNode = $from.node(taskItemDepth);
				const isAtEndOfTaskItem =
					$from.parentOffset === $from.parent.content.size &&
					$from.index(taskItemDepth) === taskItemNode.childCount - 1;

				if (isAtEndOfTaskItem) {
					if (taskItemNode.textContent.trim().length === 0) {
						return deleteTaskItem(editor, taskItemDepth);
					}
					if (editor.commands.joinForward()) {
						return true;
					}
					return true;
				}

				return false;
			}
		};
	},

	addNodeView() {
		return ({ node: initialNode, HTMLAttributes, getPos, editor }) => {
			let currentNode = initialNode;

			const dom = document.createElement('li');
			dom.setAttribute('data-type', 'taskItem');
			dom.setAttribute('data-checked', currentNode.attrs.checked ? 'true' : 'false');
			if (HTMLAttributes.class) {
				dom.className = HTMLAttributes.class;
			}

			const label = document.createElement('label');
			label.contentEditable = 'false';

			const checkbox = document.createElement('input');
			checkbox.type = 'checkbox';
			checkbox.checked = !!currentNode.attrs.checked;
			const blurActiveSearchInput = () => {
				if (document.activeElement instanceof HTMLElement && document.activeElement.matches('.task-list-search-input')) {
					document.activeElement.blur();
				}
			};

			checkbox.addEventListener('mousedown', (event) => {
				blurActiveSearchInput();
				event.preventDefault();
			});

			const toggleCheck = (e: Event) => {
				blurActiveSearchInput();
				e.stopPropagation();
				const newChecked = checkbox.checked;

				if (typeof getPos !== 'function') {
					checkbox.checked = !newChecked;
					return;
				}

				const pos = getPos();
				if (typeof pos !== 'number') {
					checkbox.checked = !newChecked;
					return;
				}

				const liveNode = editor.state.doc.nodeAt(pos);
				if (!liveNode || liveNode.type.name !== 'taskItem') {
					checkbox.checked = !newChecked;
					return;
				}

				// Handle read-only mode checkbox toggles
				if (!editor.isEditable) {
					const onReadOnlyChecked = this.options.onReadOnlyChecked as
						| ((node: ProseMirrorNode, checked: boolean, pos?: number) => boolean)
						| undefined;
					const handled = typeof onReadOnlyChecked === 'function'
						? onReadOnlyChecked(liveNode, newChecked, pos)
						: false;
					
					if (!handled) {
						editor.view.dispatch(
							editor.state.tr.setNodeMarkup(pos, undefined, {
								...liveNode.attrs,
								checked: newChecked
							})
						);
					}
					return;
				}

				// Handle edit mode checkbox toggles using live position
				const applied = editor.chain()
					.focus(undefined, { scrollIntoView: false })
					.command(({ tr }) => {
						const livePos = getPos();
						if (typeof livePos !== 'number') return false;

						const nodeAtPos = tr.doc.nodeAt(livePos);
						if (!nodeAtPos || nodeAtPos.type.name !== 'taskItem') return false;

						tr.setNodeMarkup(livePos, undefined, {
							...nodeAtPos.attrs,
							checked: newChecked
						});
						return true;
					})
					.run();

				if (!applied) checkbox.checked = !newChecked;
			};

			checkbox.addEventListener('change', toggleCheck);

			label.appendChild(checkbox);
			dom.appendChild(label);

			const contentDOM = document.createElement('div');
			dom.appendChild(contentDOM);

			return {
				dom,
				contentDOM,
				stopEvent(event: Event) {
					const target = event.target as HTMLElement | null;
					return !!target?.closest('label, input[type="checkbox"]');
				},
				ignoreMutation(mutation: ViewMutationRecord) {
					return mutation.type === 'attributes' &&
						mutation.target === dom &&
						mutation.attributeName === 'class';
				},
				update(updatedNode) {
					if (updatedNode.type.name !== 'taskItem') return false;
					currentNode = updatedNode;
					dom.setAttribute('data-checked', updatedNode.attrs.checked ? 'true' : 'false');
					checkbox.checked = !!updatedNode.attrs.checked;
					return true;
				}
			};
		};
	}
});

/**
 * Enhanced TaskList extension featuring:
 * 1. Smart auto-sorting of completed items to the bottom of the list when checked.
 * 2. Single-line header featuring circular progress percentage, compact search, filter tabs, and + Add Item button.
 */
export const EnhancedTaskList = TaskList.extend({
	addProseMirrorPlugins() {
		return [
			...(this.parent?.() || []),
			new Plugin({
				key: new PluginKey('taskListAutoSort'),
				appendTransaction(transactions, oldState, newState) {
					if (!transactions.some((tr) => tr.docChanged)) return null;

					// Check if any taskItem's checked attribute changed between oldState and newState
					let checkboxStateChanged = false;
					const oldCheckedMap = new Map<string, boolean>();

					oldState.doc.descendants((node, pos) => {
						if (node.type.name === 'taskItem') {
							oldCheckedMap.set(`${pos}`, !!node.attrs?.checked);
						}
					});

					newState.doc.descendants((node, pos) => {
						if (node.type.name === 'taskItem') {
							const wasChecked = oldCheckedMap.get(`${pos}`);
							const isChecked = !!node.attrs?.checked;
							if (wasChecked !== undefined && wasChecked !== isChecked) {
								checkboxStateChanged = true;
							}
						}
					});

					// Only reorder when a checkbox was toggled, not on normal typing
					if (!checkboxStateChanged) return null;

					const toReorder: Array<{ pos: number; node: ProseMirrorNode; sorted: ProseMirrorNode[] }> = [];

					newState.doc.descendants((node, pos) => {
						if (node.type.name === 'taskList' && node.childCount > 1) {
							const children: ProseMirrorNode[] = [];
							node.forEach((child) => children.push(child));

							let seenChecked = false;
							let needsSort = false;
							for (const child of children) {
								const isChecked = !!child.attrs?.checked;
								if (isChecked) {
									seenChecked = true;
								} else if (seenChecked) {
									needsSort = true;
									break;
								}
							}

							if (needsSort) {
								const unchecked = children.filter((c) => !c.attrs?.checked);
								const checked = children.filter((c) => !!c.attrs?.checked);
								toReorder.push({
									pos,
									node,
									sorted: [...unchecked, ...checked]
								});
							}
						}
					});

					if (toReorder.length === 0) return null;

					toReorder.sort((a, b) => b.pos - a.pos);

					const tr = newState.tr;
					for (const item of toReorder) {
						const start = item.pos + 1;
						const end = item.pos + item.node.nodeSize - 1;
						tr.replaceWith(start, end, Fragment.fromArray(item.sorted));
					}

					return tr;
				}
			})
		];
	},

	addNodeView() {
		return ({ node, getPos, editor }) => {
			const dom = document.createElement('div');
			dom.className = 'task-list-wrapper';

			const header = document.createElement('div');
			header.className = 'task-list-header';
			header.contentEditable = 'false';

			// Append header FIRST so it comes at the top of the block
			dom.appendChild(header);

			const contentDOM = document.createElement('ul');
			contentDOM.setAttribute('data-type', 'taskList');
			contentDOM.className = 'task-list-content';

			// Append contentDOM SECOND (below header)
			dom.appendChild(contentDOM);

			// State variables for filter and search query
			let currentFilter: 'all' | 'todo' | 'done' = 'all';
			let searchQuery = '';

			// Component 0: Add New Item Button at Far Right (+)
			const addBtn = document.createElement('button');
			addBtn.type = 'button';
			addBtn.className = 'task-list-add-btn';
			addBtn.title = 'Add new item at top';
			addBtn.innerHTML = `<svg viewBox="0 0 24 24" class="task-add-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

			const stopBtnEvents = (e: Event) => {
				e.stopPropagation();
				e.preventDefault();
			};

			addBtn.addEventListener('mousedown', stopBtnEvents);
			addBtn.addEventListener('pointerdown', stopBtnEvents);
			addBtn.addEventListener('click', (e: Event) => {
				e.stopPropagation();
				e.preventDefault();

				if (!editor || !editor.isEditable) return;
				if (typeof getPos !== 'function') return;
				const pos = getPos();
				if (typeof pos !== 'number') return;

				const { schema } = editor.state;
				const taskItemType = schema.nodes.taskItem;
				if (!taskItemType) return;

				const paragraphType = schema.nodes.paragraph;
				const newTaskItem = taskItemType.createAndFill(
					{ checked: false },
					paragraphType ? paragraphType.create() : undefined
				);
				if (!newTaskItem) return;

				const topPos = pos + 1;
				const tr = editor.state.tr.insert(topPos, newTaskItem);

				const focusPos = topPos + 2;
				const resolvedPos = Math.min(focusPos, tr.doc.content.size);
				tr.setSelection(TextSelection.create(tr.doc, resolvedPos));

				editor.view.dispatch(tr);
				editor.view.focus();

				if (currentFilter === 'done') {
					setFilter('all');
				} else {
					updateFiltering();
				}
			});

			// Single Line Component 1: Compact Search Input
			const searchWrapper = document.createElement('div');
			searchWrapper.className = 'task-list-search-wrapper';
			searchWrapper.innerHTML = `<svg class="task-list-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`;

			const searchInput = document.createElement('input');
			searchInput.type = 'text';
			searchInput.className = 'task-list-search-input';
			searchInput.placeholder = 'Search...';

			const stopIsolation = (e: Event) => {
				e.stopPropagation();
			};

			searchInput.addEventListener('mousedown', stopIsolation);
			searchInput.addEventListener('pointerdown', stopIsolation);
			searchInput.addEventListener('click', stopIsolation);
			searchInput.addEventListener('keydown', stopIsolation);
			searchInput.addEventListener('keyup', stopIsolation);

			searchWrapper.appendChild(searchInput);

			// Single Line Component 2: Filter Pills
			const filterPills = document.createElement('div');
			filterPills.className = 'task-list-filter-pills';

			const createFilterButton = (label: string, filterVal: 'all' | 'todo' | 'done', isActive = false) => {
				const btn = document.createElement('button');
				btn.type = 'button';
				btn.className = `task-filter-pill${isActive ? ' active' : ''}`;
				btn.textContent = label;

				btn.addEventListener('mousedown', (e) => {
					e.stopPropagation();
					e.preventDefault();
				});
				btn.addEventListener('pointerdown', (e) => {
					e.stopPropagation();
					e.preventDefault();
				});
				btn.addEventListener('click', (e: Event) => {
					e.stopPropagation();
					e.preventDefault();
					setFilter(filterVal);
				});

				return btn;
			};

			const btnAll = createFilterButton('All', 'all', true);
			const btnTodo = createFilterButton('To Do', 'todo', false);
			const btnDone = createFilterButton('Done', 'done', false);

			filterPills.appendChild(btnAll);
			filterPills.appendChild(btnTodo);
			filterPills.appendChild(btnDone);

			// Assemble single-line header: Search Box -> Filter Pills -> Add Item (+) at Far Right
			header.appendChild(searchWrapper);
			header.appendChild(filterPills);
			header.appendChild(addBtn);

			// Deactivate search field cursor on pointerdown outside search input
			const handleGlobalPointer = (e: Event) => {
				const target = e.target as Node | null;
				if (target && !searchInput.contains(target)) {
					if (document.activeElement === searchInput) {
						searchInput.blur();
					}
				}
			};
			document.addEventListener('pointerdown', handleGlobalPointer, { capture: true });

			const updateFiltering = () => {
				searchQuery = searchInput.value.trim().toLowerCase();
				const items = Array.from(contentDOM.children) as HTMLElement[];

				items.forEach((item) => {
					if (item.tagName.toLowerCase() !== 'li') return;

					const isChecked =
						item.getAttribute('data-checked') === 'true' ||
						item.querySelector('input[type="checkbox"]:checked') !== null;

					const itemText = item.textContent?.toLowerCase() || '';
					const matchesSearch = !searchQuery || itemText.includes(searchQuery);
					let matchesFilter = true;
					if (currentFilter === 'todo') matchesFilter = !isChecked;
					if (currentFilter === 'done') matchesFilter = isChecked;

					if (matchesSearch && matchesFilter) {
						item.classList.remove('task-item-hidden');
					} else {
						item.classList.add('task-item-hidden');
					}
				});

				// Hide header if nested inside another task list
				const isNested = dom.parentElement && dom.parentElement.closest('ul[data-type="taskList"]');
				if (isNested) {
					header.classList.add('is-hidden');
				} else {
					header.classList.remove('is-hidden');
				}
			};

			searchInput.addEventListener('input', updateFiltering);

			const setFilter = (filter: 'all' | 'todo' | 'done') => {
				currentFilter = filter;
				btnAll.classList.toggle('active', filter === 'all');
				btnTodo.classList.toggle('active', filter === 'todo');
				btnDone.classList.toggle('active', filter === 'done');
				updateFiltering();
			};

			requestAnimationFrame(updateFiltering);

			return {
				dom,
				contentDOM,
				update(updatedNode) {
					if (updatedNode.type.name !== 'taskList') return false;
					requestAnimationFrame(updateFiltering);
					return true;
				},
				destroy() {
					document.removeEventListener('pointerdown', handleGlobalPointer, { capture: true });
				},
				stopEvent(event: Event) {
					const target = event.target as Node | null;
					if (target && header.contains(target)) {
						return true;
					}
					return false;
				},
				ignoreMutation(mutation: ViewMutationRecord) {
					const target = mutation.target as Node | null;
					if (target && header.contains(target)) {
						return true;
					}
					return false;
				}
			};
		};
	}
});
