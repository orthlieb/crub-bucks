import { error, redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/**
 * Gate for /admin/*. Non-authenticated users get bounced to /login; authed
 * non-admins get a 403 (a redirect would be more polite, but a hard error
 * makes it obvious if a link is misconfigured).
 */
export const load: LayoutServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		throw redirect(303, `/login?next=${encodeURIComponent(url.pathname)}`);
	}
	if (locals.user.role !== 'admin') {
		throw error(403, 'Admin access required');
	}
	return { user: locals.user };
};
