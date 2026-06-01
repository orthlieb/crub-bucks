import { getFeed } from '$lib/server/feed';
import { bankBalance, getFriends } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const userId = locals.user!.id;
	const mine = url.searchParams.get('mine') === '1';

	// The feed is scoped to the viewer and their friends — never global. "Just
	// me" narrows the audience to only the viewer.
	const friendIds = mine ? [] : (await getFriends(userId)).map((f) => f.id);
	const audience = new Set([userId, ...friendIds]);

	const [items, bank] = await Promise.all([getFeed({ limit: 60, audience }), bankBalance()]);
	return { items, bank, mine };
};
