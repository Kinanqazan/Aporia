import { Fragment, Slice, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorProps } from '@tiptap/pm/view';

function withoutLinks(fragment: Fragment): Fragment {
	const nodes: ProseMirrorNode[] = [];
	fragment.forEach((node) => {
		const content = node.isLeaf ? node : node.copy(withoutLinks(node.content));
		nodes.push(content.mark(node.marks.filter((mark) => mark.type.name !== 'link')));
	});
	return Fragment.fromArray(nodes);
}

export function createLinkPasteHandlers(): Required<Pick<EditorProps, 'transformPasted' | 'handlePaste'>> {
	const plainTextSlices = new WeakSet<Slice>();
	return {
		transformPasted: (slice, _view, plain) => {
			// ProseMirror reports plain-text mode for keyboard/menu paste, text-only
			// clipboards, and code blocks. Do not infer it from ClipboardEvent keys.
			if (plain) plainTextSlices.add(slice);
			return slice;
		},
		handlePaste: (view, event, slice) => {
			if (!plainTextSlices.has(slice) || !slice.size) return false;
			plainTextSlices.delete(slice);
			event.preventDefault();
			const transaction = view.state.tr.replaceSelection(
				new Slice(withoutLinks(slice.content), slice.openStart, slice.openEnd)
			).setMeta('paste', true).setMeta('preventAutolink', true).scrollIntoView();
			// Tiptap's paste rules automatically link URLs on uiEvent=paste.
			// Handle this insertion directly so plain text bypasses those rules too.
			view.dispatch(transaction);
			return true;
		}
	};
}
