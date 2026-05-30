import { redirect } from '@sveltejs/kit';
import { SESSION_COOKIE, invalidateSession, clearSessionCookie } from '$lib/server/auth/session';
import { logSecurityEvent } from '$lib/server/auth/audit';
import type { Actions } from './$types';

export const actions: Actions = {
	default: async (event) => {
		const token = event.cookies.get(SESSION_COOKIE);
		const userId = event.locals.user?.id ?? null;
		if (token) await invalidateSession(token);
		clearSessionCookie(event);
		await logSecurityEvent({ userId, eventType: 'logout', event });
		throw redirect(303, '/login');
	}
};
