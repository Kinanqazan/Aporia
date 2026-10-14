import { Node } from '@tiptap/core';

function assetUrl(id: string, mode: 'open' | 'download', fileName?: string) {
	const query = `${mode}=1`;
	return `/assets/${encodeURIComponent(id)}?${query}${mode === 'open' && fileName ? `&filename=${encodeURIComponent(fileName)}` : ''}`;
}

function formatSize(bytes: number) {
	if (!Number.isFinite(bytes) || bytes < 0) return '';
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB'];
	let size = bytes / 1024;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) {
		size /= 1024;
		unit += 1;
	}
	return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unit]}`;
}

const extensionCategories: Record<string, string> = {
	pdf: 'pdf',
	zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', tgz: 'archive', bz2: 'archive', xz: 'archive',
	doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
	xls: 'spreadsheet', xlsx: 'spreadsheet', ods: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet',
	ppt: 'presentation', pptx: 'presentation', odp: 'presentation',
	json: 'code', xml: 'code', yaml: 'code', yml: 'code', js: 'code', ts: 'code', jsx: 'code', tsx: 'code', html: 'code', css: 'code', sql: 'code', md: 'code',
	png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', svg: 'image', bmp: 'image', heic: 'image',
	mp3: 'audio', m4a: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio',
	mp4: 'video', mov: 'video', webm: 'video', mkv: 'video'
};

const mimeTypeBadges: Record<string, { label: string; category: string }> = {
	'application/pdf': { label: 'PDF', category: 'pdf' },
	'application/zip': { label: 'ZIP', category: 'archive' },
	'application/x-zip-compressed': { label: 'ZIP', category: 'archive' },
	'application/x-7z-compressed': { label: '7Z', category: 'archive' },
	'application/vnd.rar': { label: 'RAR', category: 'archive' },
	'application/json': { label: 'JSON', category: 'code' },
	'text/csv': { label: 'CSV', category: 'spreadsheet' },
	'application/msword': { label: 'DOC', category: 'document' },
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { label: 'DOCX', category: 'document' },
	'application/vnd.ms-excel': { label: 'XLS', category: 'spreadsheet' },
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { label: 'XLSX', category: 'spreadsheet' }
};

function fileTypeBadge(fileName: string, mimeType: string) {
	const dot = fileName.lastIndexOf('.');
	const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
	const mimeBadge = mimeTypeBadges[mimeType.toLowerCase()];
	return {
		label: extension ? extension.slice(0, 4).toUpperCase() : mimeBadge?.label ?? 'FILE',
		category: extensionCategories[extension] ?? mimeBadge?.category ?? 'file'
	};
}

export const FileAttachment = Node.create({
	name: 'fileAttachment',
	group: 'block',
	atom: true,
	selectable: true,
	addAttributes() {
		return {
			assetId: { default: null },
			shareId: { default: null },
			fileName: { default: 'Attachment' },
			mimeType: { default: 'application/octet-stream' },
			size: { default: 0 }
		};
	},
	parseHTML() {
		return [{ tag: 'div[data-file-attachment]' }];
	},
	renderHTML({ node, HTMLAttributes }) {
		return [
			'div',
			{ ...HTMLAttributes, 'data-file-attachment': 'true', class: 'editor-file-attachment' },
			[
				'a',
				{ href: assetUrl(node.attrs.assetId, 'open', node.attrs.fileName), target: '_blank', rel: 'noopener noreferrer' },
				node.attrs.fileName
			],
			[
				'a',
				{ href: assetUrl(node.attrs.assetId, 'download'), download: node.attrs.fileName, class: 'editor-file-attachment-download' },
				'Download'
			]
		];
	},
	addNodeView() {
		return ({ node: initialNode }) => {
			let node = initialNode;
			const card = document.createElement('div');
			card.className = 'editor-file-attachment';
			card.setAttribute('data-file-attachment', 'true');
			const link = document.createElement('a');
			link.className = 'editor-file-attachment-open';
			link.target = '_blank';
			link.rel = 'noopener noreferrer';
			const download = document.createElement('a');
			download.className = 'editor-file-attachment-download';
			download.textContent = 'Download';

			const icon = document.createElement('span');
			icon.className = 'editor-file-attachment-icon';
			icon.setAttribute('aria-hidden', 'true');
			const details = document.createElement('span');
			details.className = 'editor-file-attachment-details';
			const name = document.createElement('span');
			name.className = 'editor-file-attachment-name';
			const metadata = document.createElement('span');
			metadata.className = 'editor-file-attachment-metadata';
			details.append(name, metadata);
			link.append(icon, details);
			card.append(link, download);

			const render = () => {
				const badge = fileTypeBadge(node.attrs.fileName, node.attrs.mimeType);
				link.href = assetUrl(node.attrs.assetId, 'open', node.attrs.fileName);
				link.setAttribute('aria-label', `Open ${node.attrs.fileName}`);
				download.href = assetUrl(node.attrs.assetId, 'download');
				download.download = node.attrs.fileName;
				download.setAttribute('aria-label', `Download ${node.attrs.fileName}`);
				icon.textContent = badge.label;
				icon.dataset.fileType = badge.category;
				name.textContent = node.attrs.fileName;
				metadata.textContent = `${node.attrs.mimeType} · ${formatSize(node.attrs.size)}`;
			};
			render();

			return {
				dom: card,
				update(nextNode) {
					if (nextNode.type !== initialNode.type) return false;
					node = nextNode;
					render();
					return true;
				},
				stopEvent: (event) => event.target instanceof Element && Boolean(event.target.closest('a')),
				ignoreMutation: () => true
			};
		};
	}
});
