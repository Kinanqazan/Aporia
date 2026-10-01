import assert from 'node:assert/strict';
import test from 'node:test';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Details, { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { EditorState, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { detailsClipboardRange, createDetailsClipboardPlugin } from './extensions/DetailsClipboard.ts';
import { createPreserveDetailsLevelPlugin } from './extensions/PreserveDetailsLevel.ts';

const schema = getSchema([StarterKit, Details.extend({
	addAttributes() {
		return { ...this.parent?.(), level: { default: 1 } };
	}
}).configure({ persist: true }), DetailsContent, DetailsSummary]);
const paragraph = (text = '') => schema.node('paragraph', null, text ? schema.text(text) : undefined);
function toggle(title: string, body: string | ProseMirrorNode[], level = 1, open = false) {
	return schema.node('details', { level, open }, [
		schema.node('detailsSummary', null, schema.text(title)),
		schema.node('detailsContent', null, typeof body === 'string' ? paragraph(body) : body)
	]);
}
const first = toggle('Alexander Pope', [
	schema.node('blockquote', null, paragraph('The world forgetting, by the world forgot.')),
	paragraph('Before we die.'),
	toggle('Nested heading', 'Nested body', 3),
	schema.node('bulletList', null, schema.node('listItem', null, paragraph('Embedded list')))
], 2);
const second = toggle('Jericho Brown', 'Embedded poem', 3);
function editorState(nodes: ProseMirrorNode[]) {
	return EditorState.create({ doc: schema.node('doc', null, nodes), plugins: [createPreserveDetailsLevelPlugin()] });
}
function copiedSlice(state: EditorState) {
	const range = detailsClipboardRange(state);
	return range ? state.doc.slice(range.from, range.to) : state.selection.content();
}

for (const open of [false, true]) {
	test(`copying a complete ${open ? 'open' : 'collapsed'} heading includes all nested blocks`, () => {
		const node = toggle('Alexander Pope', Array.from({ length: first.child(1).childCount }, (_, i) => first.child(1).child(i)), 2, open);
		const state = editorState([node]);
		const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 2 + node.firstChild!.content.size)));
		assert.deepEqual(copiedSlice(selected).content.firstChild!.toJSON(), node.toJSON());
		assert.equal(selected.selection.from, 2);
	});
}

test('two collapsed headings copy and paste with their complete bodies into a short page', () => {
	const source = editorState([first, paragraph(), second]);
	const end = first.nodeSize + 2 + 2 + second.firstChild!.content.size;
	const selected = source.apply(source.tr.setSelection(TextSelection.create(source.doc, 2, end)));
	const target = editorState([paragraph()]);
	const pasted = target.applyTransaction(target.tr.replaceSelection(copiedSlice(selected))).state;
	assert.deepEqual(pasted.doc.child(0).toJSON(), first.toJSON());
	assert.deepEqual(pasted.doc.child(2).toJSON(), second.toJSON());
});

test('a fully selected toggle node already carries its body', () => {
	const state = editorState([first]);
	const selected = state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0)));
	assert.equal(detailsClipboardRange(selected), null);
	assert.deepEqual(copiedSlice(selected).content.firstChild!.toJSON(), first.toJSON());
});

test('partial heading text and body-only selections keep normal text copying', () => {
	const state = editorState([first]);
	for (const [from, to] of [[3, 7], [first.firstChild!.nodeSize + 4, first.firstChild!.nodeSize + 8]]) {
		const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
		assert.equal(detailsClipboardRange(selected), null);
	}
	assert.equal(detailsClipboardRange(state), null);
});

test('a heading copied inside a nested toggle includes that nested body only', () => {
	const inner = toggle('Inner', 'Nested body', 3);
	const outer = toggle('Outer', [paragraph('Introduction'), inner]);
	const state = editorState([outer]);
	let pos = 0;
	state.doc.descendants((node, position) => { if (node === inner) pos = position; });
	const selected = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos + 2, pos + 2 + inner.firstChild!.content.size)));
	assert.deepEqual(copiedSlice(selected).content.firstChild!.toJSON(), inner.toJSON());
});

test('pasting after existing content does not read beyond the old document', () => {
	const state = editorState([paragraph('short')]);
	const result = state.applyTransaction(state.tr.insert(state.doc.content.size, [first, second]));
	assert.deepEqual(result.state.doc.child(2).toJSON(), second.toJSON());
});

test('pasted H1 toggles never inherit the level of a destination toggle', () => {
	const state = editorState([toggle('Existing H3', 'Old body', 3)]);
	const pasted = toggle('Pasted H1', 'New body');
	const inserted = state.applyTransaction(state.tr.insert(0, pasted)).state;
	assert.equal(inserted.doc.child(0).attrs.level, 1);
	assert.equal(inserted.doc.child(1).attrs.level, 3);
	const replaced = state.applyTransaction(state.tr.replaceWith(0, state.doc.content.size, pasted)).state;
	assert.equal(replaced.doc.firstChild!.attrs.level, 1);
});

test('opening a surviving H3 toggle preserves its heading level', () => {
	const state = editorState([second]);
	const opened = state.applyTransaction(state.tr.setNodeMarkup(0, undefined, { open: true })).state;
	assert.equal(opened.doc.firstChild!.attrs.level, 3);
	assert.equal(opened.doc.firstChild!.attrs.open, true);
});

test('a toggle moved by earlier edits still preserves its own level', () => {
	const state = editorState([second]);
	const prefix = paragraph('Inserted before the toggle');
	const tr = state.tr.insert(0, prefix).setNodeMarkup(prefix.nodeSize, undefined, { open: true });
	const result = state.applyTransaction(tr).state;
	assert.equal(result.doc.child(1).attrs.level, 3);
});

test('an explicit heading change to H1 wins over level preservation', () => {
	const state = editorState([second]);
	const tr = state.tr.setNodeMarkup(0, undefined, { ...second.attrs, level: 1 }).setMeta('toggleHeadingLevelChange', true);
	assert.equal(state.applyTransaction(tr).state.doc.firstChild!.attrs.level, 1);
});

for (const cut of [false, true]) {
	test(`${cut ? 'cut' : 'copy'} writes the whole toggle and ${cut ? 'deletes that same block' : 'keeps the source unchanged'}`, () => {
		let state = editorState([first, second]);
		state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 2, 2 + first.firstChild!.content.size)));
		let serialized: Slice | undefined;
		let prevented = false;
		const payload = new Map();
		const view: any = {
			get state() { return state; }, editable: true,
			serializeForClipboard(slice: Slice) {
				serialized = slice;
				// Tiptap's text serializer uses the heading-only editor selection.
				return { dom: { innerHTML: '<details>complete content</details>' }, text: 'Alexander Pope' };
			},
			dispatch(tr: any) { state = state.apply(tr); }
		};
		const event: any = { clipboardData: {
			clearData() { payload.clear(); }, setData(type: string, value: string) { payload.set(type, value); }
		}, preventDefault() { prevented = true; } };
		const plugin = createDetailsClipboardPlugin();
		const handler = plugin.props.handleDOMEvents![cut ? 'cut' : 'copy']!;
		assert.equal(handler.call(plugin, view, event), true);
		assert.deepEqual(serialized!.content.firstChild!.toJSON(), first.toJSON());
		assert.ok(payload.get('text/plain').includes('Nested body'));
		assert.equal(prevented, true);
		assert.equal(state.doc.childCount, cut ? 1 : 2);
		assert.deepEqual(state.doc.firstChild!.toJSON(), (cut ? second : first).toJSON());
	});
}
