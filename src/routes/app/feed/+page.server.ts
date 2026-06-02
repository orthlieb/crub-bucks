import { getFeed } from '$lib/server/feed';
import { bankBalance, getFriends } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	// The feed is scoped to the viewer and their friends — never global.
	const friendIds = (await getFriends(userId)).map((f) => f.id);
	const audience = new Set([userId, ...friendIds]);

	const [items, bank] = await Promise.all([getFeed({ limit: 60, audience }), bankBalance()]);
	return { items, bank };
};
