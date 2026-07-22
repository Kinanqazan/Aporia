import { redirect } from '@sveltejs/kit';
import { deleteSession } from '$lib/server/auth';

export const POST = ({ cookies }) => {
	deleteSession();
	cookies.delete('aporia_session', { path: '/' });
	throw redirect(303, '/login');
};
