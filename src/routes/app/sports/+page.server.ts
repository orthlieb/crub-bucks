import { getFeed, dedupeEvents } from '$lib/server/sports';
import { listMarketViews, type MarketView } from '$lib/server/sports/markets';
import type { PageServerLoad } from './$types';

/**
 * Sports list — existing parimutuel markets, grouped like the Bets tab. Each
 * card links to its detail page (`/app/sports/[id]`). Settled markets carry
 * their stored final score; in-play markets get a live score from the feed.
 */

type Phase = 'upcoming' | 'live' | 'settled';
function marketPhase(m: MarketView, now: number): Phase {
	if (m.status === 'resolved' || m.status === 'void') return 'settled';
	return Date.parse(m.startTime) <= now ? 'live' : 'upcoming';
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const markets = await listMarketViews(userId);

	// Live scores for still-open games come from the feed (best-effort); settled
	// games use the score stored at resolution.
	let liveById = new Map<string, { home: number | null; away: number | null }>();
	if (markets.some((m) => m.status === 'open')) {
		try {
			const events = dedupeEvents(await getFeed().listUpcoming());
			liveById = new Map(events.map((e) => [e.eventId, { home: e.homeScore, away: e.awayScore }]));
		} catch {
			// feed unreachable — just omit live scores this load
		}
	}

	const now = Date.now();
	const withExtras = markets.map((m) => {
		let score: { home: number; away: number } | null = null;
		if (m.homeScore !== null && m.awayScore !== null) {
			score = { home: m.homeScore, away: m.awayScore };
		} else {
			const live = liveById.get(m.eventId);
			if (live && live.home !== null && live.away !== null) {
				score = { home: live.home, away: live.away };
			}
		}
		return { ...m, phase: marketPhase(m, now), score };
	});

	const sports = [...new Set(markets.map((m) => m.sport))].sort();
	return { markets: withExtras, sports };
};
