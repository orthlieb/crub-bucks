import { getFeed, dedupeEvents } from '$lib/server/sports';
import type { PageServerLoad } from './$types';

/**
 * Read-only preview of the sports feed. Lists whatever the configured provider
 * returns (synthetic multi-sport fixtures under SPORTS_FEED=mock, live data
 * under SPORTS_FEED=espn). Nothing here touches the ledger — this is just a
 * window onto the feed while the betting layer is still being designed.
 */
export const load: PageServerLoad = async () => {
	const feed = getFeed();
	// dedupe is a no-op for a single provider but guards against the same game
	// arriving twice once we aggregate multiple feeds.
	const events = dedupeEvents(await feed.listUpcoming());
	// Kickoff order: soonest first.
	events.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));
	// Sports present, for the filter chips.
	const sports = [...new Set(events.map((e) => e.sport))].sort();
	return { provider: feed.provider, events, sports };
};
