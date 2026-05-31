import { redirect, type Handle } from '@sveltejs/kit';
import {
	SESSION_COOKIE,
	validateSessionToken,
	setSessionCookie,
	clearSessionCookie
} from '$lib/server/auth/session';
import { getSystemConfig } from '$lib/server/auth/system-config';

/**
 * Paths that should always remain reachable when maintenance mode is on:
 *   - /maintenance       the maintenance landing itself
 *   - /login, /logout    so admins can authenticate to turn it off
 *   - /admin/*           the admin panel
 *   - SvelteKit internals (_app, etc.) and Vite dev assets
 */
function isMaintenanceAllowed(pathname: string): boolean {
	if (pathname.startsWith('/_app/')) return true;
	if (pathname.startsWith('/@')) return true; // vite dev
	if (pathname === '/maintenance') return true;
	if (pathname === '/login' || pathname.startsWith('/login/')) return true;
	if (pathname === '/logout' || pathname.startsWith('/logout/')) return true;
	if (pathname === '/admin' || pathname.startsWith('/admin/')) return true;
	if (pathname.startsWith('/favicon')) return true;
	return false;
}

export const handle: Handle = async ({ event, resolve }) => {
	// --- session + locals --------------------------------------------------
	const token = event.cookies.get(SESSION_COOKIE);
	if (token) {
		const { session, user } = await validateSessionToken(token);
		if (session && user && user.isActive) {
			// Re-set on every request so sliding renewal extends the cookie
			// too — but preserve the original remember choice, so an
			// un-remembered session stays ephemeral.
			setSessionCookie(event, token, session.expiresAt, session.remember);
			event.locals.user = user;
			event.locals.session = session;
		} else {
			clearSessionCookie(event);
			event.locals.user = null;
			event.locals.session = null;
		}
	} else {
		event.locals.user = null;
		event.locals.session = null;
	}

	// --- maintenance gate --------------------------------------------------
	// Admins always pass. Everyone else is bounced to /maintenance on any
	// non-allowlisted path.
	if (event.locals.user?.role !== 'admin') {
		const cfg = await getSystemConfig().catch(() => null);
		if (cfg?.maintenanceMode && !isMaintenanceAllowed(event.url.pathname)) {
			throw redirect(307, '/maintenance');
		}
	}

	return resolve(event);
};
