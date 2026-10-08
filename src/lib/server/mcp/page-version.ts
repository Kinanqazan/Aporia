export function pageVersion(revision: number, generation: string): string {
	return Buffer.from(`${generation}:${revision}`).toString('base64url');
}

export function parsePageVersion(version: string): { generation: string; revision: number } | null {
	try {
		const decoded = Buffer.from(version, 'base64url').toString('utf8');
		const separator = decoded.lastIndexOf(':');
		const generation = decoded.slice(0, separator);
		const revision = Number(decoded.slice(separator + 1));
		if (!generation || !Number.isSafeInteger(revision) || revision < 1) return null;
		return { generation, revision };
	} catch {
		return null;
	}
}
