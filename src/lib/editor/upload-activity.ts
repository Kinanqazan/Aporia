async function requestActivity(action: 'start' | 'renew' | 'finish', id?: string): Promise<string | undefined> {
	const response = await fetch('/api/assets/activity', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ action, id }), keepalive: action === 'finish',
		signal: AbortSignal.timeout(10_000)
	});
	const result = await response.json();
	if (!response.ok || !result.success) throw new Error(result.error || 'Unable to coordinate the upload');
	return result.id;
}

export async function startUploadActivity() {
	const id = await requestActivity('start');
	if (!id) throw new Error('Unable to start the upload');
	const controller = new AbortController();
	const heartbeat = setInterval(() => {
		void requestActivity('renew', id).catch(error => controller.abort(error));
	}, 30_000);
	return {
		id, signal: controller.signal,
		// Failed saves keep renewing until a retry succeeds or the editor closes.
		async finish() {
			clearInterval(heartbeat);
			await requestActivity('finish', id);
		},
		abandon() { clearInterval(heartbeat); }
	};
}

export type UploadActivity = Awaited<ReturnType<typeof startUploadActivity>>;
