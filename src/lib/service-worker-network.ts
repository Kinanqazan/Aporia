/** Preserve a failed fetch as a network error without rejecting the worker event. */
export async function fetchOrNetworkError(request: Request, fetcher: typeof fetch = fetch): Promise<Response> {
	try {
		return await fetcher(request);
	} catch {
		return Response.error();
	}
}
