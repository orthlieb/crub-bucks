import { getFeed } from '$lib/server/feed';
import { bankBalance } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, locals }) => {
	const mine = url.searchParams.get('mine') === '1';
	const [items, bank] = await Promise.all([
		getFeed({ limit: 60, userId: mine ? locals.user!.id : undefined }),
		bankBalance()
	]);
	return { items, bank, mine };
};
