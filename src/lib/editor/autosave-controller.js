/**
 * @typedef {'idle' | 'saving' | 'error' | 'conflict'} AutosaveStatus
 * @typedef {{ pageId: string, contentJson: string, expectedVersion?: string }} AutosavePayload
 * @typedef {boolean | { success: boolean, version?: string, conflict?: boolean }} AutosaveResult
 * @typedef {{ keepalive?: boolean }} FlushOptions
 */

/**
 * Coordinates debounced saves and exposes one status stream for the UI.
 *
 * @param {{
 *   save: (payload: AutosavePayload, options: FlushOptions) => Promise<AutosaveResult>,
 *   onStatusChange: (status: AutosaveStatus) => void,
 *   debounceMs?: number,
 *   successIndicatorMs?: number
 * }} options
 */
export function createAutosaveController({
	save,
	onStatusChange,
	debounceMs = 1000,
	successIndicatorMs = 900
}) {
	/** @type {Map<string, AutosavePayload>} */
	const pendingSaves = new Map();
	/** @type {Promise<boolean> | null} */
	let drainPromise = null;
	/** @type {AutosavePayload | null} */
	let activePayload = null;
	/** @type {Map<string, string>} */
	const lastSavedByPage = new Map();
	/** @type {Map<string, string>} */
	const versionsByPage = new Map();
	const conflictedPages = new Set();
	/** @type {ReturnType<typeof setTimeout> | null} */
	let debounceTimeout = null;
	/** @type {ReturnType<typeof setTimeout> | null} */
	let statusTimeout = null;
	/** @type {AutosaveStatus} */
	let status = 'idle';
	let destroyed = false;

	/** @param {AutosaveStatus} nextStatus */
	function setStatus(nextStatus) {
		status = nextStatus;
		if (!destroyed) onStatusChange(nextStatus);
	}

	function clearDebounce() {
		if (debounceTimeout !== null) clearTimeout(debounceTimeout);
		debounceTimeout = null;
	}

	function clearStatusTimeout() {
		if (statusTimeout !== null) clearTimeout(statusTimeout);
		statusTimeout = null;
	}

	function scheduleIdle() {
		if (destroyed || status !== 'saving') return;
		clearStatusTimeout();
		statusTimeout = setTimeout(() => {
			statusTimeout = null;
			if (!drainPromise && pendingSaves.size === 0) setStatus('idle');
		}, successIndicatorMs);
	}

	/** @param {AutosavePayload} payload */
	function queue(payload) {
		if (destroyed || conflictedPages.has(payload.pageId)) return;
		payload = { ...payload, expectedVersion: versionsByPage.get(payload.pageId) ?? payload.expectedVersion };
		const pendingForPage = pendingSaves.get(payload.pageId);
		if (pendingForPage?.contentJson === payload.contentJson) return;
		if (
			!pendingForPage &&
			activePayload?.pageId === payload.pageId &&
			activePayload.contentJson === payload.contentJson
		) return;
		if (
			!pendingForPage &&
			activePayload?.pageId !== payload.pageId &&
			lastSavedByPage.get(payload.pageId) === payload.contentJson
		) return;

		clearStatusTimeout();
		setStatus('saving');
		pendingSaves.set(payload.pageId, payload);
		clearDebounce();
		debounceTimeout = setTimeout(() => {
			debounceTimeout = null;
			void flush();
		}, debounceMs);
	}

	/** @param {FlushOptions} [options] */
	async function flush(options = {}) {
		clearDebounce();

		while (true) {
			if (!drainPromise) drainPromise = drain(options);
			const currentDrain = drainPromise;
			const saved = await currentDrain;
			if (drainPromise === currentDrain) drainPromise = null;

			if (!saved) return false;
			if (pendingSaves.size === 0) {
				scheduleIdle();
				return true;
			}
		}
	}

	/** @param {FlushOptions} options */
	async function drain(options) {
		while (pendingSaves.size > 0) {
			const next = pendingSaves.values().next();
			if (next.done) break;
			const payload = next.value;
			pendingSaves.delete(payload.pageId);
			activePayload = payload;
			clearStatusTimeout();
			setStatus('saving');

			/** @type {AutosaveResult} */
			let response = false;
			try {
				response = await save(payload, options);
			} catch {
				response = false;
			} finally {
				activePayload = null;
			}
			const saved = typeof response === 'boolean' ? response : response.success;

			if (!saved) {
				if (typeof response !== 'boolean' && response.conflict) {
					conflictedPages.add(payload.pageId);
					setStatus('conflict');
					return false;
				}
				// Never let an older failed request replace a newer edit that was
				// queued while the request was in flight.
				if (!pendingSaves.has(payload.pageId)) {
					pendingSaves.set(payload.pageId, payload);
				}
				setStatus('error');
				return false;
			}
			if (typeof response !== 'boolean' && response.version) versionsByPage.set(payload.pageId, response.version);
			lastSavedByPage.set(payload.pageId, payload.contentJson);
		}

		return true;
	}

	function destroy() {
		destroyed = true;
		clearDebounce();
		clearStatusTimeout();
	}

	/** @param {AutosavePayload} payload */
	/** @param {AutosavePayload} payload @param {string} [version] */
	function markSaved(payload, version) {
		lastSavedByPage.set(payload.pageId, payload.contentJson);
		if (version) versionsByPage.set(payload.pageId, version);
		conflictedPages.delete(payload.pageId);
	}

	/** @param {string} pageId */
	function isDirty(pageId) {
		return conflictedPages.has(pageId) || pendingSaves.has(pageId) || activePayload?.pageId === pageId;
	}

	/** @param {string} pageId */
	function hasConflict(pageId) { return conflictedPages.has(pageId); }
	/** @param {string} pageId */
	function getVersion(pageId) { return versionsByPage.get(pageId); }

	return {
		queue,
		flush,
		markSaved,
		isDirty,
		hasConflict,
		getVersion,
		destroy
	};
}
