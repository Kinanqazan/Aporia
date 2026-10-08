import { getSchema } from '@tiptap/core';
import { Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Details, { DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { ColumnLayout } from '../../editor/extensions/ColumnLayout.ts';
import { Column } from '../../editor/extensions/Column.ts';

const ToggleHeading = Details.extend({
	addAttributes() {
		return {
			...(this.parent?.() ?? {}),
			level: { default: 1 }
		};
	}
});

// Keep the server schema free of Svelte node views while sharing the database
// node name and persisted attributes with the editor extension.
const DatabaseBlock = Node.create({
	name: 'databaseBlock',
	group: 'block',
	atom: true,
	addAttributes() {
		return {
			columns: { default: [] }, rows: { default: [] }, options: { default: {} },
			showSummary: { default: false }, summary: { default: {} }, sort: { default: null }
		};
	}
});

const OrderedTaskItem = TaskItem.extend({
	addAttributes() {
		return { ...this.parent?.(), order: { default: null } };
	}
});

const ImageBlock = Image.extend({
	addAttributes() {
		return {
			...(this.parent?.() ?? {}),
			source: { default: 'remote' },
			assetId: { default: null }
		};
	}
});

const schema = getSchema([
	StarterKit.configure({ link: false, heading: { levels: [1, 2, 3] } }),
	ImageBlock.configure({ inline: false, allowBase64: false }), ToggleHeading.configure({ persist: true }), DetailsSummary, DetailsContent,
	Link, TaskList, OrderedTaskItem.configure({ nested: true }), Table, TableRow, TableHeader, TableCell,
	TextStyle, Color, Highlight.configure({ multicolor: true }), ColumnLayout, Column, DatabaseBlock
]);

const MAX_DOCUMENT_BYTES = 2_000_000;
const MAX_NODES = 20_000;
const MAX_DEPTH = 100;

/** Validate without serializing through ProseMirror, which could normalize attributes. */
export function validateEditorDocument(document: unknown): string | null {
	try {
		const serialized = JSON.stringify(document);
		if (!serialized || Buffer.byteLength(serialized, 'utf8') > MAX_DOCUMENT_BYTES) return 'Document exceeds the 2 MB limit';
		if (!document || typeof document !== 'object' || Array.isArray(document)) return 'Document must be an object';
		let count = 0;
		const inspect = (value: any, depth: number): void => {
			if (depth > MAX_DEPTH) throw new Error('Document nesting exceeds the limit');
			if (++count > MAX_NODES) throw new Error('Document node count exceeds the limit');
			if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Document node must be an object');
			if (typeof value.type !== 'string' || !schema.nodes[value.type]) throw new Error(`Unknown document node: ${String(value.type)}`);
			checkKnownKeys(value, ['type', 'attrs', 'marks', 'content', 'text'], value.type);
			const type = schema.nodes[value.type];
			checkAttributes(value.attrs, type.spec.attrs, value.type);
			if (value.marks !== undefined) {
				if (!Array.isArray(value.marks)) throw new Error(`Marks on ${value.type} must be an array`);
				for (const mark of value.marks) {
					if (!mark || typeof mark.type !== 'string' || !schema.marks[mark.type]) throw new Error(`Unknown mark: ${String(mark?.type)}`);
					checkKnownKeys(mark, ['type', 'attrs'], `mark ${mark.type}`);
					checkAttributes(mark.attrs, schema.marks[mark.type].spec.attrs, `mark ${mark.type}`);
				}
			}
			if (value.content !== undefined) {
				if (!Array.isArray(value.content)) throw new Error(`Content on ${value.type} must be an array`);
				for (const child of value.content) inspect(child, depth + 1);
			}
		};
		inspect(document, 0);
		const node = schema.nodeFromJSON(document);
		node.check();
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : 'Document is invalid';
	}
}

function checkAttributes(value: unknown, spec: Record<string, unknown> | undefined, label: string): void {
	if (value === undefined) return;
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Attributes on ${label} must be an object`);
	const allowed = spec ?? {};
	for (const key of Object.keys(value)) if (!(key in allowed)) throw new Error(`Unknown attribute ${key} on ${label}`);
}

function checkKnownKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
	for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`Unknown field ${key} on ${label}`);
}
