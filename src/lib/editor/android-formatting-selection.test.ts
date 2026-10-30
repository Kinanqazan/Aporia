import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createAndroidFormattingSelection } from './android-formatting-selection.ts';

const schema = getSchema([StarterKit]);
function setup() {
	const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('one two three'))]);
	const session = createAndroidFormattingSelection(TextSelection.create(doc, 5, 8));
	const state = EditorState.create({ doc, plugins: [session.plugin] });
	return { state, session };
}

test('formatting retains its target after native menu dismissal collapses selection', () => {
	const initial = setup();
	let state = initial.state.apply(initial.state.tr.setSelection(TextSelection.create(initial.state.doc, 1)));
	const selected = initial.session.getSelection(state)!;
	assert.equal(state.doc.textBetween(selected.from, selected.to), 'two');
	state = state.apply(state.tr.setSelection(selected).addMark(selected.from, selected.to, schema.marks.bold.create()));
	assert.deepEqual(state.doc.firstChild!.toJSON().content, [
		{ type: 'text', text: 'one ' },
		{ type: 'text', text: 'two', marks: [{ type: 'bold' }] },
		{ type: 'text', text: ' three' }
	]);
});

test('saved selection follows document edits and survives repeated formatting', () => {
	const { session, state } = setup();
	let next = state.apply(state.tr.insertText('prefix ', 1));
	let selected = session.getSelection(next)!;
	assert.equal(next.doc.textBetween(selected.from, selected.to), 'two');
	next = next.apply(next.tr.addMark(selected.from, selected.to, schema.marks.italic.create()));
	selected = session.getSelection(next)!;
	assert.equal(next.doc.textBetween(selected.from, selected.to), 'two');
	assert.equal(next.doc.rangeHasMark(selected.from, selected.to, schema.marks.italic), true);
});

test('deleting the saved text disables formatting instead of targeting adjacent text', () => {
	const { session, state } = setup();
	const next = state.apply(state.tr.delete(5, 8));
	assert.equal(session.getSelection(next), null);
});
