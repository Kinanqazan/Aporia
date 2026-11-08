import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import { createSearchHighlightPlugin, searchHighlightKey } from './search-highlight.js';

test('a locked-page match is decorated without changing the document or selection', () => {
	const schema = getSchema([StarterKit]);
	const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('A matching word')])]);
	const plugin = createSearchHighlightPlugin();
	let state = EditorState.create({ doc, plugins: [plugin] });
	const selection = state.selection;
	state = state.apply(state.tr.setMeta(searchHighlightKey, { from: 3, to: 11 }));
	assert.equal(state.doc, doc);
	assert.ok(state.selection.eq(selection));
	const decorations = plugin.props.decorations(state).find();
	assert.equal(decorations.length, 1);
	assert.equal(decorations[0].from, 3);
	assert.equal(decorations[0].to, 11);
	assert.equal(decorations[0].type.attrs.class, 'search-result-highlight');
});
