import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { changePassword, isPasswordConfigured } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
	if (!isPasswordConfigured()) throw redirect(307, '/setup');
};

export const actions: Actions = {
	default: async ({ request, cookies }) => {
		const data = await request.formData();
		const currentPassword = data.get('currentPassword');
		const newPassword = data.get('newPassword');
		const confirmation = data.get('confirmation');

		if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || typeof confirmation !== 'string') {
			return fail(400, { error: 'All fields are required.' });
		}
		if (newPassword.length < 12) return fail(400, { error: 'Use a password with at least 12 characters.' });
		if (newPassword !== confirmation) return fail(400, { error: 'Passwords do not match.' });
		if (!(await changePassword(currentPassword, newPassword))) {
			return fail(400, { error: 'The current password is incorrect.' });
		}

		cookies.delete('aporia_session', { path: '/' });
		throw redirect(303, '/login');
	}
};
