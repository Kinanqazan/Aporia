import { Plugin, PluginKey, TextSelection, type EditorState, type SelectionBookmark } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey<SelectionBookmark>('androidFormattingSelection');

// Native ActionMode dismissal can collapse DOM/editor selection. Keep a separate
// bookmark, mapped through edits, for every action in the formatting sheet.
export function createAndroidFormattingSelection(selection: TextSelection) {
	const getSelection = (state: EditorState) => {
		const selected = key.getState(state)?.resolve(state.doc);
		return selected instanceof TextSelection && !selected.empty ? selected : null;
	};
	return {
		key,
		getSelection,
		plugin: new Plugin<SelectionBookmark>({
			key,
			state: {
				init: () => selection.getBookmark(),
				apply: (tr, bookmark) => bookmark.map(tr.mapping)
			},
			props: {
				decorations(state) {
					const selected = getSelection(state);
					return selected ? DecorationSet.create(state.doc, [
						Decoration.inline(selected.from, selected.to, { class: 'android-formatting-selection' })
					]) : DecorationSet.empty;
				}
			}
		})
	};
}
