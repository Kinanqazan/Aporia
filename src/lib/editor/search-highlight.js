import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const searchHighlightKey = new PluginKey('searchResultHighlight');

export function createSearchHighlightPlugin() {
	return new Plugin({
		key: searchHighlightKey,
		state: {
			init: () => DecorationSet.empty,
			apply(transaction, decorations) {
				const match = transaction.getMeta(searchHighlightKey);
				if (match) {
					return DecorationSet.create(transaction.doc, [
						Decoration.inline(match.from, match.to, { class: 'search-result-highlight' })
					]);
				}
				return transaction.docChanged || transaction.selectionSet
					? DecorationSet.empty
					: decorations;
			}
		},
		props: { decorations: (state) => searchHighlightKey.getState(state) }
	});
}
