import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Poetry } from './extensions/Poetry.ts';
import { unwrapPoetryBlock } from './poetry-conversion.ts';

function editorWithPoem() {
	return new Editor({ element: null, extensions: [StarterKit, Poetry], content: {
		type: 'doc', content: [{ type: 'poetry', content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'First line' }] },
			{ type: 'paragraph' },
			{ type: 'paragraph', content: [{ type: 'text', text: 'Second stanza' }] }
		] }]
	} });
}

test('converting a poem to paragraphs unwraps all lines and blank lines', () => {
	const editor = editorWithPoem();
	assert.equal(unwrapPoetryBlock(editor, 0), true);
	assert.deepEqual(editor.getJSON().content?.map((node) => node.type), ['paragraph', 'paragraph', 'paragraph']);
	assert.equal(editor.getText(), 'First line\n\n\n\nSecond stanza');
});

test('converting a poem to a quote keeps every line in one quote', () => {
	const editor = editorWithPoem();
	assert.equal(unwrapPoetryBlock(editor, 0), true);
	assert.equal(editor.commands.toggleBlockquote(), true);
	const content = editor.getJSON().content ?? [];
	assert.equal(content.length, 1);
	assert.equal(content[0].type, 'blockquote');
	assert.equal(content[0].content?.length, 3);
});
