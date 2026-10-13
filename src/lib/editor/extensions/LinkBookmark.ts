import { mergeAttributes, Node } from '@tiptap/core';

export function normalizeLinkBookmarkUrl(value: unknown): string {
	if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001F\u007F]/.test(value)) return '';
	try {
		const url = new URL(value.trim());
		if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return '';
		return url.toString();
	} catch {
		return '';
	}
}

export function linkBookmarkHost(value: string): string {
	try {
		return new URL(value).hostname.replace(/^www\./i, '');
	} catch {
		return '';
	}
}

export const LinkBookmark = Node.create({
	name: 'linkBookmark',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addAttributes() {
		return {
			url: {
				default: '',
				parseHTML: (element) => element.getAttribute('data-url') || element.getAttribute('href') || '',
				renderHTML: (attributes) => ({ 'data-url': attributes.url })
			},
			title: {
				default: '',
				parseHTML: (element) => element.getAttribute('data-title') || '',
				renderHTML: (attributes) => ({ 'data-title': attributes.title })
			}
		};
	},

	parseHTML() {
		return [{ tag: 'a[data-link-bookmark]' }];
	},

	renderHTML({ node, HTMLAttributes }) {
		const url = normalizeLinkBookmarkUrl(node.attrs.url);
		const title = typeof node.attrs.title === 'string' && node.attrs.title.trim()
			? node.attrs.title.trim()
			: linkBookmarkHost(url) || 'Link';

		if (!url) return ['span', { class: 'editor-link-bookmark-invalid' }, title];

		return [
			'a',
			mergeAttributes(HTMLAttributes, {
				class: 'editor-link-bookmark',
				'data-link-bookmark': 'true',
				href: url,
				target: '_blank',
				rel: 'noopener noreferrer',
				'aria-label': title
			}),
			['span', { class: 'editor-link-bookmark-title' }, title]
		];
	}
});

