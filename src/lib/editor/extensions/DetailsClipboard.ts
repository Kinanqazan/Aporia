import { Extension, getTextBetween, getTextSerializersFromSchema } from '@tiptap/core';
import { Plugin, TextSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/** A fully selected toggle summary represents its whole block, including hidden content. */
export function detailsClipboardRange(state: EditorState) {
	const { from, to, empty } = state.selection;
	if (empty || !(state.selection instanceof TextSelection)) return null;
	let start = from;
	let end = to;
	state.doc.descendants((node, pos) => {
		if (node.type.name !== 'details') return;
		const summary = node.firstChild;
		if (summary?.type.name !== 'detailsSummary') return;
		const summaryStart = pos + 2;
		const summaryEnd = summaryStart + summary.content.size;
		if (from <= summaryStart && to >= summaryEnd) {
			start = Math.min(start, pos);
			end = Math.max(end, pos + node.nodeSize);
		}
	});
	return start === from && end === to ? null : { from: start, to: end };
}

function copyDetails(view: EditorView, event: ClipboardEvent, cut: boolean) {
	if (cut && !view.editable) return false;
	const range = detailsClipboardRange(view.state);
	if (!range || !event.clipboardData) return false;

	const { dom } = view.serializeForClipboard(view.state.doc.slice(range.from, range.to));
	// Tiptap's default text serializer reads the original selection, ignoring
	// the expanded slice. Give both clipboard formats the same block range.
	const text = getTextBetween(view.state.doc, range, {
		textSerializers: getTextSerializersFromSchema(view.state.schema)
	});
	event.clipboardData.clearData();
	event.clipboardData.setData('text/html', dom.innerHTML);
	event.clipboardData.setData('text/plain', text);
	event.preventDefault();
	// Cut must remove exactly the content placed on the clipboard.
	if (cut) view.dispatch(view.state.tr.delete(range.from, range.to).scrollIntoView().setMeta('uiEvent', 'cut'));
	return true;
}

export function createDetailsClipboardPlugin() {
	return new Plugin({
		props: {
			handleDOMEvents: {
				copy: (view, event) => copyDetails(view, event, false),
				cut: (view, event) => copyDetails(view, event, true)
			}
		}
	});
}

export const DetailsClipboard = Extension.create({
	name: 'detailsClipboard',
	addProseMirrorPlugins() {
		return [createDetailsClipboardPlugin()];
	}
});
