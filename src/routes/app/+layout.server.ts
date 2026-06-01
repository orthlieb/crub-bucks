import { redirect } from '@sveltejs/kit';
import { countIncomingRequests, latestIncomingPayment } from '$lib/server/ledger';
import { listActiveForUser } from '$lib/server/notifications';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	if (!locals.user) throw redirect(302, '/login');
	// Lets the client poll just this loader (cha-ching / notifications / friend
	// request count) via invalidate('app:activity') without re-running page loads.
	depends('app:activity');
	const [pendingFriendRequests, notifications, lastPayment] = await Promise.all([
		countIncomingRequests(locals.user.id).catch(() => 0),
		listActiveForUser(locals.user.id).catch(() => []),
		// Drives the "cha-ching" cue; the client decides if it's new to them.
		latestIncomingPayment(locals.user.id).catch(() => null)
	]);
	return { user: locals.user, pendingFriendRequests, notifications, lastPayment };
};
