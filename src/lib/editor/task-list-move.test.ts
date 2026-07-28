import assert from 'node:assert/strict';
import test from 'node:test';
import { Schema, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { moveTaskItem, TASK_INTERACTION_META } from './extensions/TaskListExtension.ts';

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { group: 'block', content: 'text*' },
		text: { group: 'inline' },
		taskList: { group: 'block', content: 'taskItem+' },
		taskItem: {
			content: 'paragraph taskList?',
			attrs: { checked: { default: false } }
		}
	}
});

function paragraph(text: string) {
	return schema.node('paragraph', null, text ? schema.text(text) : undefined);
}

function taskItem(text: string, nestedItems: ProseMirrorNode[] = []) {
	const content = [paragraph(text)];
	if (nestedItems.length) content.push(schema.node('taskList', null, nestedItems));
	return schema.node('taskItem', null, content);
}

function taskList(items: ProseMirrorNode[]) {
	return schema.node('taskList', null, items);
}

function positionsByText(doc: ProseMirrorNode) {
	const positions = new Map<string, number>();
	doc.descendants((node, pos) => {
		if (node.type.name === 'taskItem') positions.set(node.firstChild?.textContent ?? '', pos);
	});
	return positions;
}

function editorFor(doc: ProseMirrorNode) {
	let state = EditorState.create({ doc });
	let dispatchedTransaction = state.tr;
	return {
		get state() {
			return state;
		},
		get dispatchedTransaction() {
			return dispatchedTransaction;
		},
		view: {
			dispatch(transaction: typeof dispatchedTransaction) {
				dispatchedTransaction = transaction;
				state = state.apply(transaction);
			},
			focus() {}
		}
	};
}

function topLevelTaskTexts(doc: ProseMirrorNode) {
	const list = doc.firstChild;
	return list ? Array.from({ length: list.childCount }, (_, index) => list.child(index).firstChild?.textContent) : [];
}

test('task dragging reorders items within the same list and tags the transaction', () => {
	const editor = editorFor(schema.node('doc', null, [taskList([taskItem('A'), taskItem('B'), taskItem('C')])]));
	const positions = positionsByText(editor.state.doc);

	assert.equal(moveTaskItem(editor, positions.get('B')!, positions.get('A')!, false), true);
	assert.deepEqual(topLevelTaskTexts(editor.state.doc), ['B', 'A', 'C']);
	assert.equal(editor.dispatchedTransaction.getMeta(TASK_INTERACTION_META), true);
});

test('task dragging is constrained to one task list', () => {
	const editor = editorFor(schema.node('doc', null, [
		taskList([taskItem('A'), taskItem('B')]),
		taskList([taskItem('C'), taskItem('D')])
	]));
	const before = editor.state.doc.toJSON();
	const positions = positionsByText(editor.state.doc);

	assert.equal(moveTaskItem(editor, positions.get('A')!, positions.get('C')!, false), false);
	assert.deepEqual(editor.state.doc.toJSON(), before);
});

test('task dragging resolves the containing nested task list', () => {
	const editor = editorFor(schema.node('doc', null, [
		taskList([taskItem('Outer', [taskItem('B'), taskItem('C')])])
	]));
	const positions = positionsByText(editor.state.doc);

	assert.equal(moveTaskItem(editor, positions.get('C')!, positions.get('B')!, false), true);
	const nestedList = editor.state.doc.firstChild?.firstChild?.child(1);
	assert.deepEqual(
		nestedList ? Array.from({ length: nestedList.childCount }, (_, index) => nestedList.child(index).firstChild?.textContent) : [],
		['C', 'B']
	);
});
