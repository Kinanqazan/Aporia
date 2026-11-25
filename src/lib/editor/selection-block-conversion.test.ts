import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Poetry } from './extensions/Poetry.ts';
import { convertBlockWrapper, convertSelectedParagraphs } from './selection-block-conversion.ts';

for (const type of ['blockquote', 'poetry'] as const) {
	test(`selected paragraphs become one ${type} without losing content`, () => {
		const editor = new Editor({ element: null, extensions: [StarterKit, Poetry], content: {
			type: 'doc', content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }] },
				{ type: 'paragraph' },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Last' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'After' }] }
			]
		} });
		assert.equal(convertSelectedParagraphs(editor, type, { from: 9, to: 20 }), true);
		const blocks = editor.getJSON().content ?? [];
		assert.deepEqual(blocks.map((node) => node.type), ['paragraph', type, 'paragraph']);
		assert.deepEqual(blocks[1].content, [
			{ type: 'paragraph', content: [{ type: 'text', marks: [{ type: 'bold' }], text: 'First' }] },
			{ type: 'paragraph' },
			{ type: 'paragraph', content: [{ type: 'text', text: 'Last' }] }
		]);
	});
}

test('converting a quote with soft line breaks to poetry creates separate poetry lines', () => {
	const editor = new Editor({ element: null, extensions: [StarterKit, Poetry], content: {
		type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [
			{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }, { type: 'hardBreak' },
			{ type: 'text', text: 'Second' }
		] }] }]
	} });
	assert.equal(convertSelectedParagraphs(editor, 'poetry', { from: 2, to: 14 }), true);
	const blocks = editor.getJSON().content ?? [];
	assert.equal(blocks[0].type, 'poetry');
	assert.deepEqual(blocks[0].content, [
		{ type: 'paragraph', content: [{ type: 'text', text: 'First', marks: [{ type: 'bold' }] }] },
		{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }
	]);
});

test('converting a poetry block to quote repeatedly never nests wrappers', () => {
	const editor = new Editor({ element: null, extensions: [StarterKit, Poetry], content: {
		type: 'doc', content: [{ type: 'poetry', content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
			{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }
		] }]
	} });
	assert.equal(convertSelectedParagraphs(editor, 'blockquote', { from: 2, to: 16 }), true);
	assert.equal(convertSelectedParagraphs(editor, 'blockquote', { from: 2, to: 16 }), true);
	const blocks = editor.getJSON().content ?? [];
	assert.equal(blocks.length, 1);
	assert.equal(blocks[0].type, 'blockquote');
	assert.deepEqual(blocks[0].content?.map((node) => node.type), ['paragraph', 'paragraph']);
});

test('block menu conversion flattens existing nested quotes and preserves blank soft lines', () => {
	const editor = new Editor({ element: null, extensions: [StarterKit, Poetry], content: {
		type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'blockquote', content: [
			{ type: 'paragraph', content: [{ type: 'text', text: 'First' }, { type: 'hardBreak' },
				{ type: 'hardBreak' }, { type: 'text', text: 'Last' }] }
		] }] }]
	} });
	assert.equal(convertBlockWrapper(editor, 0, 'poetry'), true);
	const blocks = editor.getJSON().content ?? [];
	assert.equal(blocks[0].type, 'poetry');
	assert.deepEqual(blocks[0].content, [
		{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
		{ type: 'paragraph' },
		{ type: 'paragraph', content: [{ type: 'text', text: 'Last' }] }
	]);
});
