import { getSchema } from '@tiptap/core';
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

const ToggleHeading = Details.extend({
	addAttributes() {
		return {
			...(this.parent?.() ?? {}),
			level: {
				default: 1,
				parseHTML: (element) => Number(element.getAttribute('data-heading-level')) || 1,
				renderHTML: (attributes) => ({ 'data-heading-level': attributes.level })
			}
		};
	}
});

const schema = getSchema([
	StarterKit.configure({
		link: false,
		heading: { levels: [1, 2, 3] }
	}),
	Image.configure({ inline: false, allowBase64: false }),
	ToggleHeading,
	DetailsSummary,
	DetailsContent,
	Link,
	TaskList,
	TaskItem.configure({ nested: true }),
	Table,
	TableRow,
	TableHeader,
	TableCell
]);

export function validateTiptapDocument(document: unknown): string | null {
	try {
		if (!document || typeof document !== 'object' || (document as { type?: string }).type !== 'doc') {
			return 'Generated content is not a Tiptap document';
		}
		schema.nodeFromJSON(document);
		return null;
	} catch (error) {
		return error instanceof Error ? error.message : 'Generated content is invalid';
	}
}
