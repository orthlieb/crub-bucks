import { getFeed } from '$lib/server/feed';
import type { PageServerLoad } from './$types';

// Admin-gated by /admin/+layout.server. This is the one place the feed runs
// globally (audience: 'all') — every user's activity, for moderation/support.
export const load: PageServerLoad = async () => {
	const items = await getFeed({ limit: 300, audience: 'all' });
	return { items };
};
