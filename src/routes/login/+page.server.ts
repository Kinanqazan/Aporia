import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSession, hasValidSession, isPasswordConfigured, verifyCredentials } from '$lib/server/auth';

export const load: PageServerLoad = async ({ cookies }) => {
	if (!isPasswordConfigured()) {
		throw redirect(307, '/setup');
	}

	if (hasValidSession(cookies.get('aporia_session'))) {
		throw redirect(307, '/');
	}
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const enteredUsername = data.get('username');
		const enteredPassword = data.get('password');

		if (!isPasswordConfigured()) {
			throw redirect(307, '/setup');
		}

		if (
			typeof enteredUsername === 'string' &&
			typeof enteredPassword === 'string' &&
			await verifyCredentials(enteredUsername, enteredPassword)
		) {
			cookies.set('aporia_session', createSession(), {
				path: '/',
				httpOnly: true,
				sameSite: 'strict',
				secure: process.env.NODE_ENV === 'production',
				maxAge: 60 * 60 * 24 * 30 // 30 days
			});

			throw redirect(307, '/');
		}

		return fail(400, { incorrect: true, error: 'Incorrect password' });
	}
};
