import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
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
