const databaseTableAttribute = 'data-database-block="true"';

export function csvToHtml(csv: string, title: string): string {
	const records = parseCsv(csv);
	if (records.length === 0 || records.every((record) => record.every((cell) => !cell.trim()))) {
		throw new Error('The selected CSV file is empty');
	}

	const headers = records[0].map((header, index) => header.trim() || `Column ${index + 1}`);
	const body = records.slice(1).filter((record) => record.some((cell) => cell.trim()));
	const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('');
	const rowsHtml = body.map((record) => `<tr>${headers.map((_, index) => `<td>${escapeHtml(record[index] || '')}</td>`).join('')}</tr>`).join('');

	return `<h1>${escapeHtml(title)}</h1><table ${databaseTableAttribute}><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table>`;
}

export function markdownToHtml(markdown: string): string {
	const lines = stripFrontmatter(markdown).replace(/\r\n?/g, '\n').split('\n');
	const output: string[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index].trim();
		if (!line) {
			index += 1;
			continue;
		}

		if (line.startsWith('```')) {
			const codeLines: string[] = [];
			index += 1;
			while (index < lines.length && !lines[index].trim().startsWith('```')) {
				codeLines.push(lines[index]);
				index += 1;
			}
			if (index < lines.length) index += 1;
			output.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`);
			continue;
		}

		if (isMarkdownTableSeparator(lines[index + 1])) {
			const header = splitMarkdownRow(lines[index]);
			const body: string[][] = [];
			index += 2;
			while (index < lines.length && lines[index].trim().includes('|') && lines[index].trim()) {
				body.push(splitMarkdownRow(lines[index]));
				index += 1;
			}
			output.push(markdownTableToHtml(header, body));
			continue;
		}

		const heading = /^(#{1,6})\s+(.+)$/.exec(line);
		if (heading) {
			output.push(`<h${heading[1].length}>${inlineMarkdown(heading[2])}</h${heading[1].length}>`);
			index += 1;
			continue;
		}

		if (/^[-*_]{3,}$/.test(line)) {
			output.push('<hr>');
			index += 1;
			continue;
		}

		const paragraphLines = [line];
		index += 1;
		while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines, index)) {
			paragraphLines.push(lines[index].trim());
			index += 1;
		}
		output.push(`<p>${inlineMarkdown(paragraphLines.join(' '))}</p>`);
	}

	return output.join('');
}

export function titleFromMarkdown(markdown: string, fallback: string): string {
	const heading = markdown.replace(/^---[\s\S]*?---\s*/m, '').match(/^#\s+(.+)$/m);
	return cleanTitle(heading?.[1] || fallback);
}

export function countMarkdownTables(markdown: string): number {
	const lines = stripFrontmatter(markdown).replace(/\r\n?/g, '\n').split('\n');
	let count = 0;
	for (let index = 0; index < lines.length - 1; index += 1) {
		if (lines[index].trim().includes('|') && isMarkdownTableSeparator(lines[index + 1])) {
			count += 1;
			index += 1;
		}
	}
	return count;
}

export function parseCsv(input: string): string[][] {
	const value = input.replace(/^\uFEFF/, '');
	const records: string[][] = [];
	let record: string[] = [];
	let cell = '';
	let quoted = false;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		if (quoted) {
			if (character === '"' && value[index + 1] === '"') {
				cell += '"';
				index += 1;
			} else if (character === '"') {
				quoted = false;
			} else {
				cell += character;
			}
		} else if (character === '"' && cell.length === 0) {
			quoted = true;
		} else if (character === ',') {
			record.push(cell);
			cell = '';
		} else if (character === '\n') {
			record.push(cell.replace(/\r$/, ''));
			if (record.some((entry) => entry.trim())) records.push(record);
			record = [];
			cell = '';
		} else {
			cell += character;
		}
	}

	record.push(cell.replace(/\r$/, ''));
	if (record.some((entry) => entry.trim())) records.push(record);
	return records;
}

function markdownTableToHtml(header: string[], body: string[][]): string {
	const headerHtml = header.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join('');
	const bodyHtml = body.map((row) => `<tr>${header.map((_, index) => `<td>${inlineMarkdown(row[index] || '')}</td>`).join('')}</tr>`).join('');
	return `<table ${databaseTableAttribute}><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
}

function splitMarkdownRow(line: string): string[] {
	let value = line.trim();
	if (value.startsWith('|')) value = value.slice(1);
	if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
	const cells: string[] = [];
	let cell = '';
	let escaped = false;
	for (const character of value) {
		if (escaped) {
			cell += character;
			escaped = false;
		} else if (character === '\\') {
			escaped = true;
		} else if (character === '|') {
			cells.push(cell.trim());
			cell = '';
		} else {
			cell += character;
		}
	}
	cells.push(cell.trim());
	return cells;
}

function isMarkdownTableSeparator(line: string | undefined): boolean {
	if (!line || !line.includes('|')) return false;
	return splitMarkdownRow(line).length > 0 && splitMarkdownRow(line).every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function isMarkdownBlockStart(lines: string[], index: number): boolean {
	const line = lines[index].trim();
	return /^#{1,6}\s+/.test(line) || line.startsWith('```') || /^[-*_]{3,}$/.test(line) || isMarkdownTableSeparator(lines[index + 1]);
}

function inlineMarkdown(value: string): string {
	let result = escapeHtml(value);
	result = result.replace(/`([^`]+)`/g, '<code>$1</code>');
	result = result.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	result = result.replace(/__([^_]+)__/g, '<strong>$1</strong>');
	result = result.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>');
	return result;
}

function stripFrontmatter(value: string): string {
	return value.replace(/^\uFEFF?---\s*\n[\s\S]*?\n---\s*\n/, '');
}

function cleanTitle(value: string): string {
	return value.replace(/\s+/g, ' ').trim() || 'Untitled';
}

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character);
}
