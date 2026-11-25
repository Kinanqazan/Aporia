import type { Editor } from '@tiptap/core';
import { Fragment, type Node as PMNode, type Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

type Range = { from: number; to: number };
export type SelectionBlockType = 'blockquote' | 'poetry';

function convertWrapper(tr: Transaction, position: number, type: SelectionBlockType, schema: Schema): boolean {
	const wrapper = tr.doc.nodeAt(position);
	if (!wrapper || !['blockquote', 'poetry'].includes(wrapper.type.name)) return false;
	const paragraphs: PMNode[] = [];
	const collect = (node: PMNode): boolean => {
		if (node.type.name === 'paragraph') {
			let content: PMNode[] = [];
			node.forEach((child) => {
				if (type === 'poetry' && child.type.name === 'hardBreak') {
					paragraphs.push(node.type.create(node.attrs, Fragment.fromArray(content), node.marks));
					content = [];
				} else content.push(child);
			});
			paragraphs.push(node.type.create(node.attrs, Fragment.fromArray(content), node.marks));
			return true;
		}
		if (!['blockquote', 'poetry'].includes(node.type.name)) return false;
		let valid = true;
		node.forEach((child) => { if (!collect(child)) valid = false; });
		return valid;
	};
	if (!collect(wrapper)) return false;
	const replacement = schema.nodes[type].createChecked(null, Fragment.fromArray(paragraphs));
	if (!wrapper.eq(replacement)) tr.replaceWith(position, position + wrapper.nodeSize, replacement);
	return true;
}

/** Convert a whole quote or poem targeted by the block menu. */
export function convertBlockWrapper(editor: Editor, position: number, type: SelectionBlockType): boolean {
	return editor.commands.command(({ tr, state }) => convertWrapper(tr, position, type, state.schema));
}

/** Convert selected paragraphs, or replace their existing quote/poetry wrapper. */
export function convertSelectedParagraphs(editor: Editor, type: SelectionBlockType, range: Range): boolean {
	if (!editor.isEditable || range.from > range.to) return false;
	return editor.chain().setTextSelection(range).command(({ tr, state, commands }) => {
		const { $from, $to } = tr.selection;
		const sharedDepth = $from.sharedDepth($to.pos);
		for (let depth = 1; depth <= sharedDepth; depth++) {
			if (['blockquote', 'poetry'].includes($from.node(depth).type.name)) {
				return convertWrapper(tr, $from.before(depth), type, state.schema);
			}
		}
		if (!commands.wrapIn(type)) return false;
		if (type !== 'poetry') return true;
		const $wrapped = tr.selection.$from;
		for (let depth = $wrapped.depth; depth > 0; depth--) {
			if ($wrapped.node(depth).type.name === 'poetry') return convertWrapper(tr, $wrapped.before(depth), type, state.schema);
		}
		return false;
	}).run();
}
