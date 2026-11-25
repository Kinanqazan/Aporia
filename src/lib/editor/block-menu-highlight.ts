import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const blockMenuHighlightKey = new PluginKey<DecorationSet>('blockMenuHighlight');

/** Highlight the exact block targeted by the open gutter menu. */
export function createBlockMenuHighlight() {
	return new Plugin({
		key: blockMenuHighlightKey,
		state: {
			init: () => DecorationSet.empty,
			apply(tr, decorations) {
				const position: number | null | undefined = tr.getMeta(blockMenuHighlightKey);
				if (position === undefined) return decorations.map(tr.mapping, tr.doc);
				if (position === null) return DecorationSet.empty;
				const node = tr.doc.nodeAt(position);
				return node ? DecorationSet.create(tr.doc, [
					Decoration.node(position, position + node.nodeSize, { class: 'block-menu-target' })
				]) : DecorationSet.empty;
			}
		},
		props: { decorations: (state) => blockMenuHighlightKey.getState(state) }
	});
}
