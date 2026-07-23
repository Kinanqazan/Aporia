import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { configurePassword, isPasswordConfigured, createSession, sessionCookieOptions } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
	if (isPasswordConfigured()) {
		throw redirect(307, '/login');
	}

	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const username = data.get('username');
		const password = data.get('password');
		const confirmation = data.get('confirmation');

		if (typeof username !== 'string' || typeof password !== 'string' || typeof confirmation !== 'string') {
			return fail(400, { error: 'All fields are required.' });
		}
		if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
			return fail(400, { error: 'Use 3–32 letters, numbers, dots, dashes, or underscores for the username.' });
		}

		if (password.length < 12) {
			return fail(400, { error: 'Use a password with at least 12 characters.' });
		}

		if (password !== confirmation) {
			return fail(400, { error: 'Passwords do not match.' });
		}

		if (!(await configurePassword(username, password))) {
			return fail(400, { error: 'Setup is already complete.' });
		}

		cookies.set('aporia_session', createSession(true), sessionCookieOptions(true));

		throw redirect(303, '/');
	}
};
