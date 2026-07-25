import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ViewMutationRecord } from '@tiptap/pm/view';

/**
 * Extended TaskItem extension that ensures checkbox checking works identically
 * and reliably in BOTH Edit Mode and Locked/Read-Only Mode without stale node references.
 */
export const EnhancedTaskItem = TaskItem.extend({
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
			checkbox.addEventListener('mousedown', (event) => event.preventDefault());

			const toggleCheck = (e: Event) => {
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
 * 2. Single-line header featuring circular progress percentage, compact search, and filter tabs.
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
		return ({ node }) => {
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

			// Single Line Component 1: Circular Progress Ring Badge
			const progressBadge = document.createElement('div');
			progressBadge.className = 'task-progress-circle-badge';
			progressBadge.title = 'Completion Progress';
			progressBadge.innerHTML = `
				<svg class="task-progress-svg" viewBox="0 0 24 24">
					<circle class="task-progress-bg" cx="12" cy="12" r="9"></circle>
					<circle class="task-progress-circle-fill" cx="12" cy="12" r="9"></circle>
				</svg>
				<span class="task-progress-badge-text">0% (0/0)</span>
			`;

			// Single Line Component 2: Compact Search Input
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

			// Single Line Component 3: Filter Pills
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
				btn.addEventListener('click', (e) => {
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

			// Assemble single-line header: Search Box (Bigger) -> Circular Progress Badge -> Filter Pills
			header.appendChild(searchWrapper);
			header.appendChild(progressBadge);
			header.appendChild(filterPills);

			const updateFilteringAndProgress = () => {
				searchQuery = searchInput.value.trim().toLowerCase();
				const items = Array.from(contentDOM.children) as HTMLElement[];

				let total = 0;
				let completed = 0;

				items.forEach((item) => {
					if (item.tagName.toLowerCase() !== 'li') return;
					total++;

					const isChecked =
						item.getAttribute('data-checked') === 'true' ||
						item.querySelector('input[type="checkbox"]:checked') !== null;
					if (isChecked) completed++;

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

				const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
				
				// Update SVG circle stroke fill & percentage label
				const circleFill = progressBadge.querySelector('.task-progress-circle-fill') as SVGCircleElement | null;
				const textLabel = progressBadge.querySelector('.task-progress-badge-text');

				if (circleFill) {
					const circumference = 56.548; // 2 * pi * 9
					const offset = circumference - (percentage / 100) * circumference;
					circleFill.style.strokeDashoffset = `${offset}`;
				}

				if (textLabel) {
					textLabel.textContent = `${percentage}% (${completed}/${total})`;
				}

				// Hide header if nested inside another task list
				const isNested = dom.parentElement && dom.parentElement.closest('ul[data-type="taskList"]');
				if (isNested) {
					header.classList.add('is-hidden');
				} else {
					header.classList.remove('is-hidden');
				}
			};

			searchInput.addEventListener('input', updateFilteringAndProgress);

			const setFilter = (filter: 'all' | 'todo' | 'done') => {
				currentFilter = filter;
				btnAll.classList.toggle('active', filter === 'all');
				btnTodo.classList.toggle('active', filter === 'todo');
				btnDone.classList.toggle('active', filter === 'done');
				updateFilteringAndProgress();
			};

			requestAnimationFrame(updateFilteringAndProgress);

			return {
				dom,
				contentDOM,
				update(updatedNode) {
					if (updatedNode.type.name !== 'taskList') return false;
					requestAnimationFrame(updateFilteringAndProgress);
					return true;
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
