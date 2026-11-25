import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOrNetworkError } from './service-worker-network.ts';

test('a failed network request returns a network error without an unhandled rejection', async () => {
	const response = await fetchOrNetworkError(new Request('https://example.test/'), async () => {
		throw new TypeError('Failed to fetch');
	});
	assert.equal(response.type, 'error');
});

test('a successful network response is passed through', async () => {
	const response = await fetchOrNetworkError(new Request('https://example.test/'), async () => new Response('ok'));
	assert.equal(await response.text(), 'ok');
});
