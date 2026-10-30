import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import { createAndroidFormattingSelection, createAndroidFormattingSelectionTracker, getAndroidFormattingSelection } from './android-formatting-selection.ts';

const schema = getSchema([StarterKit]);
function setup() {
	const doc = schema.node('doc', null, [schema.node('paragraph', null, schema.text('one two three'))]);
	const selection = TextSelection.create(doc, 5, 8);
	const session = createAndroidFormattingSelection(selection);
	const state = EditorState.create({ doc, selection, plugins: [session.plugin] });
	return { state, session };
}

test('Format uses the live editor range after Android transfers focus to its action menu', () => {
	const { state } = setup();
	const selection = getAndroidFormattingSelection(state, true, false);
	assert.ok(selection);
	assert.equal(state.doc.textBetween(selection.from, selection.to), 'two');
	assert.equal(getAndroidFormattingSelection(state, false, false), null);
	assert.equal(getAndroidFormattingSelection(state, true, true), null);
});

test('pending native Format target survives WebView collapsing the selection before the click callback', () => {
	const { state } = setup();
	const tracker = createAndroidFormattingSelectionTracker();
	tracker.remember(state.selection as TextSelection);
	const collapse = state.tr.setSelection(TextSelection.create(state.doc, 1));
	const collapsedState = state.apply(collapse);
	tracker.map(collapse);

	const selection = tracker.getSelection(collapsedState);
	assert.ok(selection);
	assert.equal(collapsedState.doc.textBetween(selection.from, selection.to), 'two');

	const insert = collapsedState.tr.insertText('prefix ', 1);
	const editedState = collapsedState.apply(insert);
	tracker.map(insert);
	const mapped = tracker.getSelection(editedState);
	assert.ok(mapped);
	assert.equal(editedState.doc.textBetween(mapped.from, mapped.to), 'two');
	tracker.clear();
	assert.equal(tracker.getSelection(editedState), null);
});

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
