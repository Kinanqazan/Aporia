import { env } from '$env/dynamic/private';
import { redirect, type Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	const password = env.APP_PASSWORD;
	
	// If APP_PASSWORD is not configured, bypass authentication entirely
	if (!password) {
		return resolve(event);
	}

	const path = event.url.pathname;
	
	// Allow access to static assets, build files, and the login page
	if (
		path === '/login' || 
		path === '/Wolf.svg' || 
		path === '/manifest.webmanifest' ||
		path === '/apple-touch-icon.png' ||
		path.startsWith('/logo-') ||
		path.startsWith('/_app') || 
		path.startsWith('/favicon')
	) {
		return resolve(event);
	}

	const session = event.cookies.get('aporia_session');
	
	// If session doesn't match APP_PASSWORD, redirect to login page
	if (session !== password) {
		throw redirect(307, '/login');
	}

	return resolve(event);
};
