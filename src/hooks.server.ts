import { redirect, type Handle } from '@sveltejs/kit';
import { hasValidSession, isPasswordConfigured } from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	
	// Allow public authentication pages and static assets.
	if (
		path === '/login' ||
		path === '/setup' ||
		path === '/logout' ||
		(path === '/aporia-logo.svg' || path === '/aporia-logo.png') ||
		path === '/manifest.webmanifest' ||
		path.startsWith('/aporia-icon-') ||
		path.startsWith('/_app') || 
		path.startsWith('/favicon')
	) {
		return resolve(event);
	}

	if (!isPasswordConfigured()) {
		throw redirect(307, '/setup');
	}

	const session = event.cookies.get('aporia_session');
	
	if (!hasValidSession(session)) {
		throw redirect(307, '/login');
	}

	return resolve(event);
};
