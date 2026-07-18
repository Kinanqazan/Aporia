import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchPages } from '$lib/server/pages';

export const GET: RequestHandler = async ({ url }) => {
	const query = url.searchParams.get('q') || '';
	if (!query.trim()) {
		return json({ results: [] });
	}

	const results = searchPages(query);
	return json({ results });
};
