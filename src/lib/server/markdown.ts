export function tiptapToMarkdown(jsonStr: string): string {
	try {
		const doc = JSON.parse(jsonStr);
		return convertNode(doc, 0);
	} catch {
		return '';
	}
}

function convertNode(node: any, indentLevel = 0): string {
	if (!node) return '';
	const indent = '  '.repeat(indentLevel);

	switch (node.type) {
		case 'doc':
			if (Array.isArray(node.content)) {
				return node.content.map((child: any) => convertNode(child, indentLevel)).join('\n\n');
			}
			return '';

		case 'paragraph':
			return indent + convertInline(node.content);

		case 'heading': {
			const level = node.attrs?.level || 1;
			const hash = '#'.repeat(level);
			return indent + hash + ' ' + convertInline(node.content);
		}

		case 'bulletList':
			if (Array.isArray(node.content)) {
				return node.content.map((item: any) => convertNode(item, indentLevel)).join('\n');
			}
			return '';

		case 'orderedList':
			if (Array.isArray(node.content)) {
				return node.content.map((item: any, idx: number) => {
					return convertListItem(item, indentLevel, `${idx + 1}.`);
				}).join('\n');
			}
			return '';

		case 'listItem':
			return convertListItem(node, indentLevel, '-');

		case 'taskList':
			if (Array.isArray(node.content)) {
				return node.content.map((item: any) => convertNode(item, indentLevel)).join('\n');
			}
			return '';

		case 'taskItem': {
			const checked = node.attrs?.checked ? '[x]' : '[ ]';
			return convertListItem(node, indentLevel, `- ${checked}`);
		}

		case 'blockquote':
			if (Array.isArray(node.content)) {
				const contentMd = node.content.map((child: any) => convertNode(child, indentLevel)).join('\n\n');
				return contentMd.split('\n').map((line: string) => `> ${line}`).join('\n');
			}
			return '> ';

		case 'codeBlock': {
			const language = node.attrs?.language || '';
			const codeText = Array.isArray(node.content) ? node.content.map((c: any) => c.text || '').join('') : '';
			return `\`\`\`${language}\n${codeText}\n\`\`\``;
		}

		case 'horizontalRule':
			return '---';

		case 'details': {
			const summaryNode = node.content?.find((c: any) => c.type === 'detailsSummary');
			const contentNode = node.content?.find((c: any) => c.type === 'detailsContent');
			
			const summaryText = summaryNode ? convertInline(summaryNode.content) : 'Toggle';
			const contentMd = contentNode ? (contentNode.content || []).map((child: any) => convertNode(child, indentLevel + 1)).join('\n\n') : '';
			
			return `<details>\n<summary>${summaryText}</summary>\n\n${contentMd}\n\n</details>`;
		}

		case 'table': {
			if (!Array.isArray(node.content)) return '';
			const rows = node.content;
			if (rows.length === 0) return '';
			
			const mdRows: string[] = [];
			
			rows.forEach((rowNode: any, rowIdx: number) => {
				if (rowNode.type !== 'tableRow' || !Array.isArray(rowNode.content)) return;
				const cells = rowNode.content;
				
				const cellTexts = cells.map((cellNode: any) => {
					return convertInline(cellNode.content).replace(/\|/g, '\\|');
				});
				
				mdRows.push(`| ${cellTexts.join(' | ')} |`);
				
				if (rowIdx === 0) {
					const alignCells = cells.map(() => '---');
					mdRows.push(`| ${alignCells.join(' | ')} |`);
				}
			});
			
			return mdRows.join('\n');
		}

		default:
			if (Array.isArray(node.content)) {
				return node.content.map((child: any) => convertNode(child, indentLevel)).join('\n');
			}
			return '';
	}
}

function convertListItem(itemNode: any, indentLevel: number, prefix: string): string {
	const indent = '  '.repeat(indentLevel);
	if (!Array.isArray(itemNode.content)) return `${indent}${prefix} `;
	
	const inlineParts: string[] = [];
	const blockParts: string[] = [];
	
	itemNode.content.forEach((child: any) => {
		if (child.type === 'paragraph') {
			inlineParts.push(convertInline(child.content));
		} else {
			blockParts.push(convertNode(child, indentLevel + 1));
		}
	});
	
	const mainText = inlineParts.join(' ');
	const subContent = blockParts.length > 0 ? '\n' + blockParts.join('\n') : '';
	
	return `${indent}${prefix} ${mainText}${subContent}`;
}

function convertInline(content: any[] | undefined): string {
	if (!Array.isArray(content)) return '';
	return content.map((node: any) => {
		if (node.type !== 'text') return '';
		let text = node.text || '';
		
		if (Array.isArray(node.marks)) {
			node.marks.forEach((mark: any) => {
				if (mark.type === 'bold') {
					text = `**${text}**`;
				} else if (mark.type === 'italic') {
					text = `*${text}*`;
				} else if (mark.type === 'code') {
					text = `\`${text}\``;
				} else if (mark.type === 'link') {
					const href = mark.attrs?.href || '';
					text = `[${text}](${href})`;
				}
			});
		}
		return text;
	}).join('');
}
