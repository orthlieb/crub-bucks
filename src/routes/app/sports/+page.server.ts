import { getFeed } from '$lib/server/sports';
import type { PageServerLoad } from './$types';

/**
 * Read-only preview of the sports feed. Lists whatever the configured provider
 * returns (synthetic World Cup fixtures under SPORTS_FEED=mock, live data under
 * SPORTS_FEED=espn). Nothing here touches the ledger — this is just a window
 * onto the feed while the betting layer is still being designed.
 */
export const load: PageServerLoad = async () => {
	const feed = getFeed();
	const events = await feed.listUpcoming();
	// Kickoff order: soonest first.
	events.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
	return { provider: feed.provider, events };
};
