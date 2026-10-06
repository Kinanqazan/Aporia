import { createPage, updatePage } from '$lib/server/pages';

const MAX_TITLE_LENGTH = 160;
const MAX_TEXT_LENGTH = 50_000;
const MAX_URL_LENGTH = 4_096;

export type SharedContentInput = {
	title?: unknown;
	text?: unknown;
	url?: unknown;
};

type TiptapNode = Record<string, unknown>;

function cleanText(value: unknown, maxLength: number): string {
	if (typeof value !== 'string') return '';
	return value
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
		.trim()
		.slice(0, maxLength);
}

function safeHttpUrl(value: unknown): string {
	const candidate = cleanText(value, MAX_URL_LENGTH);
	if (!candidate) return '';
	try {
		const parsed = new URL(candidate);
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
		if (!parsed.hostname || parsed.username || parsed.password) return '';
		return parsed.toString();
	} catch {
		return '';
	}
}

export async function createPageFromSharedContent(input: SharedContentInput) {
	const titleInput = cleanText(input.title, MAX_TITLE_LENGTH);
	const text = cleanText(input.text, MAX_TEXT_LENGTH);
	const url = safeHttpUrl(input.url);
	if (!titleInput && !text && !url) {
		throw new Error('The shared item did not contain text or a web link.');
	}

	const titleFromText = text.split(/\r?\n/, 1)[0]?.trim() || '';
	const title = (titleInput || titleFromText || url || 'Shared from Android').slice(0, MAX_TITLE_LENGTH);
	const content: TiptapNode[] = [];
	const linkNode = url ? {
		type: 'text',
		text: url,
		marks: [{ type: 'link', attrs: { href: url } }]
	} : null;

	if (text && url && text.includes(url)) {
		const linkStart = text.indexOf(url);
		const paragraph: TiptapNode[] = [];
		if (linkStart > 0) paragraph.push({ type: 'text', text: text.slice(0, linkStart) });
		paragraph.push(linkNode!);
		const afterLink = text.slice(linkStart + url.length);
		if (afterLink) paragraph.push({ type: 'text', text: afterLink });
		content.push({ type: 'paragraph', content: paragraph });
	} else {
		if (text && text !== url) {
			content.push({ type: 'paragraph', content: [{ type: 'text', text }] });
		}
	}
	if (url && !text.includes(url)) {
		content.push({
			type: 'paragraph',
			content: [linkNode!]
		});
	}
	if (content.length === 0 && titleInput) {
		content.push({ type: 'paragraph', content: [{ type: 'text', text: titleInput }] });
	}

	const page = await createPage(null, title);
	await updatePage(page.id, {
		contentJson: JSON.stringify({ type: 'doc', content })
	});
	return page;
}
