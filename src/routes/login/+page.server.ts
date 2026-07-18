import { env } from '$env/dynamic/private';
import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ cookies }) => {
	const password = env.APP_PASSWORD;
	if (!password) {
		throw redirect(307, '/');
	}

	const session = cookies.get('aporia_session');
	if (session === password) {
		throw redirect(307, '/');
	}
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const enteredPassword = data.get('password');
		const password = env.APP_PASSWORD;

		if (!password) {
			throw redirect(307, '/');
		}

		if (enteredPassword === password) {
			cookies.set('aporia_session', password, {
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
