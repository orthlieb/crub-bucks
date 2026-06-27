import { listMarketViews, type MarketView } from '$lib/server/sports/markets';
import type { PageServerLoad } from './$types';

/**
 * Sports list — existing parimutuel markets, grouped like the Bets tab. Each
 * card links to its detail page (`/app/sports/[id]`) where wagering happens; a
 * user's first bet on a game (via `/app/sports/new`) is what opens a market.
 */

type Phase = 'upcoming' | 'live' | 'settled';
function marketPhase(m: MarketView, now: number): Phase {
	if (m.status === 'resolved' || m.status === 'void') return 'settled';
	return Date.parse(m.startTime) <= now ? 'live' : 'upcoming';
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const markets = await listMarketViews(userId);
	// Phase is computed server-side so SSR and the client agree (no hydration
	// drift around kickoff); the layout poll refreshes it.
	const now = Date.now();
	const withPhase = markets.map((m) => ({ ...m, phase: marketPhase(m, now) }));
	const sports = [...new Set(markets.map((m) => m.sport))].sort();
	return { markets: withPhase, sports };
};
