import { redirect, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	getValidSession,
	isPasswordConfigured,
	SESSION_COOKIE_NAME,
	sessionCookieOptions
} from '$lib/server/auth';

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;
	const isDemoMode = env.VERCEL === '1' && env.APORIA_DEMO_MODE === 'true';

	if (isDemoMode) {
		if (
			path === '/login' ||
			path === '/setup' ||
			path === '/change-password' ||
			path === '/logout' ||
			path === '/logout-all'
		) {
			throw redirect(303, '/');
		}

		return resolve(event);
	}
	
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

	const session = event.cookies.get(SESSION_COOKIE_NAME);
	const validSession = getValidSession(session);
	
	if (!validSession) {
		throw redirect(307, '/login');
	}

	// Refresh remembered cookies as the user works so active devices do not
	// unexpectedly expire after the fixed initial max-age.
	if (session && validSession.persistent) {
		event.cookies.set(SESSION_COOKIE_NAME, session, sessionCookieOptions(true));
	}

	return resolve(event);
};
