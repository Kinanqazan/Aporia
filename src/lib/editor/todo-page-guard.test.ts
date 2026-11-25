import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { createTodoPageGuard } from './todo-page-guard.ts';
import { EnhancedTaskList, TASK_INTERACTION_META } from './extensions/TaskListExtension.ts';

const schema = new Schema({ nodes: {
	doc: { content: 'block+' }, text: { group: 'inline' },
	paragraph: { group: 'block', content: 'text*' },
	heading: { group: 'block', content: 'text*' },
	taskList: { group: 'block', content: 'taskItem+', attrs: { pageControls: { default: false } } },
	taskItem: { content: 'paragraph block*', attrs: { checked: { default: false }, order: { default: 0 } } }
} });
const paragraph = (text: string) => schema.node('paragraph', null, text ? schema.text(text) : undefined);
const item = (text: string, order: number) => schema.node('taskItem', { checked: false, order }, paragraph(text));
const list = (pageControls: boolean) => schema.node('taskList', { pageControls }, [item('One', 0), item('Two', 1)]);

test('to-do pages reject new blocks and retain the dedicated list', () => {
	const state = EditorState.create({ doc: schema.node('doc', null, list(true)), plugins: [createTodoPageGuard()] });
	assert.equal(state.applyTransaction(state.tr.insert(state.doc.content.size, paragraph('extra'))).transactions.length, 0);
	assert.equal(state.applyTransaction(state.tr.replaceWith(0, state.doc.content.size, paragraph('replacement'))).transactions.length, 0);
	assert.equal(state.applyTransaction(state.tr.insertText('!', 3)).transactions.length, 1);
});

test('existing extra blocks are preserved and can be removed', () => {
	const extra = paragraph('existing');
	const state = EditorState.create({ doc: schema.node('doc', null, [list(true), extra]), plugins: [createTodoPageGuard()] });
	assert.equal(state.applyTransaction(state.tr.insertText('!', 3)).transactions.length, 1);
	assert.equal(state.applyTransaction(state.tr.delete(state.doc.firstChild!.nodeSize, state.doc.content.size)).transactions.length, 1);
});

test('checking sorts dedicated page items but leaves ordinary blocks in place', () => {
	const plugins = EnhancedTaskList.config.addProseMirrorPlugins!.call({ parent: () => [] } as never);
	for (const pageControls of [false, true]) {
		const state = EditorState.create({ doc: schema.node('doc', null, list(pageControls)), plugins });
		const first = state.doc.nodeAt(1)!;
		const tr = state.tr.setNodeMarkup(1, undefined, { ...first.attrs, checked: true }).setMeta(TASK_INTERACTION_META, true);
		const next = state.applyTransaction(tr).state;
		assert.deepEqual([next.doc.firstChild!.child(0).textContent, next.doc.firstChild!.child(1).textContent], pageControls ? ['Two', 'One'] : ['One', 'Two']);
	}
});
