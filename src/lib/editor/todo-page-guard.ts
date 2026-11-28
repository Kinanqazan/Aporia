import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export function todoPageListCount(doc: ProseMirrorNode) {
	let count = 0;
	doc.forEach((node) => { if (isTodoPageList(node)) count++; });
	return count;
}

function isTodoPageList(node: ProseMirrorNode) {
	return node.type.name === 'taskList' && node.attrs.pageControls;
}

function otherBlocks(doc: ProseMirrorNode) {
	const blocks: ProseMirrorNode[] = [];
	const inspect = (node: ProseMirrorNode) => {
		if (node.isInline) return;
		if (!['doc', 'taskList', 'taskItem', 'paragraph'].includes(node.type.name)) {
			blocks.push(node);
			return;
		}
		node.forEach(inspect);
	};
	doc.forEach((node) => {
		if (isTodoPageList(node)) inspect(node);
		else blocks.push(node);
	});
	return blocks;
}

export function allowsTodoPageChange(previousDoc: ProseMirrorNode, nextDoc: ProseMirrorNode): boolean {
	if (todoPageListCount(previousDoc) === 0) return true;
	if (todoPageListCount(nextDoc) !== 1) return false;
	const previous = otherBlocks(previousDoc);
	return otherBlocks(nextDoc).every((node) => {
		const index = previous.findIndex((old) => old.eq(node));
		if (index < 0) return false;
		previous.splice(index, 1);
		return true;
	});
}

// Existing extra blocks can be removed, but cannot be introduced or modified.
export function createTodoPageGuard() {
	return new Plugin({
		key: new PluginKey('todoPageGuard'),
		filterTransaction(transaction, state) {
			if (!transaction.docChanged || todoPageListCount(state.doc) === 0) return true;
			return allowsTodoPageChange(state.doc, transaction.doc);
		}
	});
}
