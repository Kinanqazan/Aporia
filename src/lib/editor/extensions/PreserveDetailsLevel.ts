import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Mapping } from '@tiptap/pm/transform';

export function createPreserveDetailsLevelPlugin() {
	return new Plugin({
		appendTransaction(transactions, oldState, newState) {
			if (!transactions.some((transaction) => transaction.docChanged) ||
				transactions.some((transaction) => transaction.getMeta('toggleHeadingLevelChange'))) {
				return null;
			}

			const mapping = new Mapping();
			for (const transaction of transactions) mapping.appendMapping(transaction.mapping);
			const tr = newState.tr;
			oldState.doc.descendants((oldNode, oldPos) => {
				if (oldNode.type.name !== 'details' || oldNode.attrs.level === 1) return;
				// Follow a surviving node through edits. Its content boundary survives
				// setNodeMarkup, but is deleted when the whole toggle is replaced.
				if (mapping.mapResult(oldPos + 1, 1).deleted) return;
				const pos = mapping.map(oldPos, 1);
				if (pos < 0 || pos >= newState.doc.content.size) return;
				const node = newState.doc.nodeAt(pos);
				if (node?.type.name === 'details' && node.attrs.level === 1 &&
					node.attrs.level !== oldNode.attrs.level) {
					tr.setNodeMarkup(pos, undefined, { ...node.attrs, level: oldNode.attrs.level });
				}
			});
			return tr.docChanged ? tr : null;
		}
	});
}

export const PreserveDetailsLevel = Extension.create({
	name: 'preserveDetailsLevel',
	addProseMirrorPlugins() {
		return [createPreserveDetailsLevelPlugin()];
	}
});
