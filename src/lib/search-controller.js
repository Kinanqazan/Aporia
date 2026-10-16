/**
 * @template T
 * @param {{ search: (query: string) => Promise<T[]>, onResults: (results: T[]) => void, onError: (error: unknown) => void }} options
 */
export function createSearchController({ search, onResults, onError }) {
	let requestId = 0;

	/** @param {string} query */
	async function update(query) {
		const currentRequest = ++requestId;
		onResults([]);
		if (!query.trim()) return;
		try {
			const results = await search(query);
			if (currentRequest === requestId) onResults(results);
		} catch (error) {
			if (currentRequest === requestId) onError(error);
		}
	}

	function cancel() { requestId += 1; }
	return { update, cancel };
}
