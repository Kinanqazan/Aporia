/**
 * Parse persisted expanded sidebar IDs without allowing malformed or duplicate
 * values into the rendered tree.
 *
 * @param {string | null | undefined} value
 * @param {Set<string>} [validIds]
 * @returns {{ ids: string[]; updatedAt: number }}
 */
export function parseExpandedSidebarState(value, validIds) {
	if (!value) return { ids: [], updatedAt: 0 };

	try {
		const parsed = JSON.parse(value);
		const rawIds = Array.isArray(parsed) ? parsed : parsed?.ids;
		if (!Array.isArray(rawIds)) return { ids: [], updatedAt: 0 };
		const updatedAt = !Array.isArray(parsed) && Number.isFinite(parsed.updatedAt)
			? Math.max(0, parsed.updatedAt)
			: 0;

		return { ids: [...new Set(rawIds.filter(
			(id) => typeof id === 'string' && (!validIds || validIds.has(id))
		))], updatedAt };
	} catch {
		return { ids: [], updatedAt: 0 };
	}
}

/**
 * @param {Iterable<string>} ids
 * @param {number} updatedAt
 */
export function serializeExpandedSidebarState(ids, updatedAt) {
	return JSON.stringify({ ids: [...new Set(ids)], updatedAt });
}

/** @param {string | null | undefined} value @param {Set<string>} [validIds] */
export function parseExpandedSidebarPageIds(value, validIds) {
	return parseExpandedSidebarState(value, validIds).ids;
}

/**
 * @param {string | null | undefined} storedValue
 * @param {string | null | undefined} incomingValue
 */
export function shouldReplaceExpandedSidebarState(storedValue, incomingValue) {
	return parseExpandedSidebarState(incomingValue).updatedAt >=
		parseExpandedSidebarState(storedValue).updatedAt;
}
