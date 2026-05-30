import { redirect } from '@sveltejs/kit';
import { countIncomingRequests } from '$lib/server/ledger';
import { listActiveForUser } from '$lib/server/notifications';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) throw redirect(302, '/login');
	const [pendingFriendRequests, notifications] = await Promise.all([
		countIncomingRequests(locals.user.id).catch(() => 0),
		listActiveForUser(locals.user.id).catch(() => [])
	]);
	return { user: locals.user, pendingFriendRequests, notifications };
};
