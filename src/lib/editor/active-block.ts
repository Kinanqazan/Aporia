import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/** Find the ProseMirror node represented by the gutter's DOM target. */
export function findActiveBlock(
	doc: PMNode,
	view: Pick<EditorView, 'nodeDOM' | 'posAtDOM'>,
	target: HTMLElement,
	saved?: { pos: number; type: string } | null
) {
	let match: { pos: number; node: PMNode } | null = null;
	doc.descendants((node, pos) => {
		if (!match && view.nodeDOM(pos) === target) {
			match = { pos, node };
			return false;
		}
		return true;
	});
	if (match) return match;
	let domPosition = -1;
	try { domPosition = view.posAtDOM(target, 0); } catch { /* The editor replaced the target element. */ }
	if (domPosition < 0 || domPosition > doc.content.size) {
		if (saved && saved.pos >= 0 && saved.pos < doc.content.size) {
			const node = doc.nodeAt(saved.pos);
			if (node?.type.name === saved.type) return { pos: saved.pos, node };
		}
		return null;
	}
	const positions = new Set<number>([domPosition, domPosition - 1]);
	const resolved = doc.resolve(domPosition);
	for (let depth = resolved.depth; depth > 0; depth--) positions.add(resolved.before(depth));
	for (const pos of positions) {
		if (pos < 0) continue;
		const node = doc.nodeAt(pos);
		if (node && view.nodeDOM(pos) === target) return { pos, node };
	}
	return null;
}
