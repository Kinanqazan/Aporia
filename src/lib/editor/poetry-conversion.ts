import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';

/** Select and unwrap every line of the poetry block targeted by its gutter. */
export function unwrapPoetryBlock(editor: Editor, position: number): boolean {
	const node = editor.state.doc.nodeAt(position);
	if (!node || node.type.name !== 'poetry') return false;
	const from = Selection.findFrom(editor.state.doc.resolve(position), 1, true);
	const to = Selection.findFrom(editor.state.doc.resolve(position + node.nodeSize), -1, true);
	if (!from || !to) return false;
	return editor.chain().setTextSelection({ from: from.from, to: to.to }).lift('poetry').run();
}
