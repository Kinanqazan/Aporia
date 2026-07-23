/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `cache-${version}`;
const ASSETS = [...build, ...files];

self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		// Resilient asset-by-asset caching to ensure a missing asset doesn't block the install.
		for (const file of ASSETS) {
			try {
				await cache.add(file);
			} catch (err) {
				console.warn(`Failed to cache asset during install: ${file}`, err);
			}
		}
	}

	event.waitUntil(addFilesToCache());
});

self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) await caches.delete(key);
		}
	}

	event.waitUntil(deleteOldCaches());
});

self.addEventListener('fetch', (event) => {
	if (event.request.method !== 'GET') return;

	async function respond() {
		const url = new URL(event.request.url);
		const cache = await caches.open(CACHE);

		// Cache-first for build assets and files in static folder
		if (ASSETS.includes(url.pathname)) {
			const cachedResponse = await cache.match(url.pathname);
			if (cachedResponse) return cachedResponse;
			try {
				const response = await fetch(event.request);
				if (response.status === 200) {
					cache.put(url.pathname, response.clone());
				}
				return response;
			} catch (err) {
				const cachedResponse = await cache.match(url.pathname);
				if (cachedResponse) return cachedResponse;
				throw err;
			}
		}

		// Never cache navigation, authentication, or API responses. These are
		// session-dependent and a cached login page can look like a logout.
		return fetch(event.request);
	}

	event.respondWith(respond());
});
