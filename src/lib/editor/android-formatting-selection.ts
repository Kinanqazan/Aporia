import { Plugin, PluginKey, TextSelection, type EditorState, type SelectionBookmark, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey<SelectionBookmark>('androidFormattingSelection');

// Keep the last real editor selection while Android's native ActionMode moves
// focus or briefly collapses the WebView selection before Format is clicked.
export function createAndroidFormattingSelectionTracker() {
	let bookmark: SelectionBookmark | null = null;
	return {
		remember(selection: TextSelection) {
			if (!selection.empty) bookmark = selection.getBookmark();
		},
		map(transaction: Transaction) {
			if (bookmark) bookmark = bookmark.map(transaction.mapping);
		},
		clear() {
			bookmark = null;
		},
		getSelection(state: EditorState) {
			const selected = bookmark?.resolve(state.doc);
			return selected instanceof TextSelection && !selected.empty ? selected : null;
		}
	};
}

// The Android action menu can take WebView focus before its item callback runs.
// Use ProseMirror's still-live document selection as the action target instead
// of requiring window.getSelection() to remain non-collapsed at that moment.
export function getAndroidFormattingSelection(
	state: EditorState,
	editable: boolean,
	locked: boolean,
	panelOpen = false
) {
	const selected = state.selection;
	return editable && !locked && !panelOpen && selected instanceof TextSelection && !selected.empty
		? selected
		: null;
}

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
