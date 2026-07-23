import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	createSession,
	hasValidSession,
	isPasswordConfigured,
	SESSION_COOKIE_NAME,
	sessionCookieOptions,
	verifyCredentials
} from '$lib/server/auth';

export const load: PageServerLoad = async ({ cookies }) => {
	if (!isPasswordConfigured()) {
		throw redirect(307, '/setup');
	}

	if (hasValidSession(cookies.get(SESSION_COOKIE_NAME))) {
		throw redirect(307, '/');
	}
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const enteredUsername = data.get('username');
		const enteredPassword = data.get('password');
		const rememberDevice = data.get('remember') === 'on';

		if (!isPasswordConfigured()) {
			throw redirect(307, '/setup');
		}

		if (
			typeof enteredUsername === 'string' &&
			typeof enteredPassword === 'string' &&
			await verifyCredentials(enteredUsername, enteredPassword)
		) {
			cookies.set('aporia_session', createSession(rememberDevice), sessionCookieOptions(rememberDevice));

			throw redirect(307, '/');
		}

		return fail(400, { incorrect: true, error: 'Incorrect password' });
	}
};
