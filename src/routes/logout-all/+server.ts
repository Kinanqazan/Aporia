import { redirect } from '@sveltejs/kit';
import { deleteAllSessions, SESSION_COOKIE_NAME } from '$lib/server/auth';

export const POST = ({ cookies }) => {
	deleteAllSessions();
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
	throw redirect(303, '/login');
};
