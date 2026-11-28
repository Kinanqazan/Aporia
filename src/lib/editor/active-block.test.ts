import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor, getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Details, { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Poetry } from './extensions/Poetry.ts';
import { findActiveBlock } from './active-block.ts';

test('a detached gutter target does not resolve an invalid position', () => {
	const schema = getSchema([StarterKit]);
	const doc = schema.nodeFromJSON({ type: 'doc', content: [
		{ type: 'paragraph', content: [{ type: 'text', text: 'New text' }] }
	] });
	const stale = {} as HTMLElement;
	const view = { nodeDOM: () => null, posAtDOM: () => -1 };
	assert.equal(findActiveBlock(doc, view, stale), null);
});

test('a detached target can use the previously tracked block position', () => {
	const schema = getSchema([StarterKit]);
	const doc = schema.nodeFromJSON({ type: 'doc', content: [
		{ type: 'paragraph', content: [{ type: 'text', text: 'New text' }] }
	] });
	const view = { nodeDOM: () => null, posAtDOM: () => -1 };
	assert.equal(findActiveBlock(doc, view, {} as HTMLElement, { pos: 0, type: 'paragraph' })?.node.textContent, 'New text');
	assert.equal(findActiveBlock(doc, view, {} as HTMLElement, { pos: 0, type: 'heading' }), null);
});

for (const hasSibling of [false, true]) {
	test(`a nested poetry block can be deleted ${hasSibling ? 'without deleting its sibling' : 'when it is the only toggle child'}`, () => {
		const editor = new Editor({ element: null, extensions: [StarterKit, Details, DetailsContent, DetailsSummary, Poetry], content: {
			type: 'doc', content: [{ type: 'details', content: [
				{ type: 'detailsSummary', content: [{ type: 'text', text: 'Heading' }] },
				{ type: 'detailsContent', content: [
					{ type: 'poetry', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Poem' }] }] },
					...(hasSibling ? [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep' }] }] : [])
				] }
			] }]
		} });
		let poetryPos = -1;
		editor.state.doc.descendants((node, pos) => { if (node.type.name === 'poetry') poetryPos = pos; });
		const target = {} as HTMLElement;
		const block = findActiveBlock(editor.state.doc, { nodeDOM: (pos) => pos === poetryPos ? target : null, posAtDOM: () => -1 }, target);
		assert.ok(block);
		editor.commands.deleteRange({ from: block.pos, to: block.pos + block.node.nodeSize });
		const toggle = editor.state.doc.firstChild!;
		assert.equal(toggle.type.name, 'details');
		assert.equal(toggle.child(0).textContent, 'Heading');
		assert.equal(toggle.child(1).childCount, 1);
		assert.equal(toggle.child(1).firstChild!.type.name, 'paragraph');
		assert.equal(toggle.child(1).textContent, hasSibling ? 'Keep' : '');
		editor.destroy();
	});
}
