import { error, fail } from '@sveltejs/kit';
import { getFeed, dedupeEvents } from '$lib/server/sports';
import type { FeedEvent, FeedEventStatus } from '$lib/server/sports';
import {
	openMarketFromEvent,
	placeWager,
	resolveMarketFromFeed,
	voidMarket,
	listMarketViews,
	MarketError,
	type MarketView,
	type WagerSide
} from '$lib/server/sports/markets';
import type { Actions, PageServerLoad } from './$types';

/**
 * Sports page: the feed's games merged with our parimutuel markets.
 * - Admins curate markets (open / resolve-from-feed / void).
 * - Any signed-in user places a wager on an open market.
 * Settlement and the zero-sum invariant live entirely in the engine
 * (markets.ts → ledger.ts); this route is just wiring.
 */

interface Card {
	key: string;
	eventId: string;
	sport: string;
	league: string;
	leagueLogo: string | null;
	startTime: string;
	feedStatus: FeedEventStatus | null;
	home: { name: string; abbr: string; logo: string | null };
	away: { name: string; abbr: string; logo: string | null };
	homeScore: number | null;
	awayScore: number | null;
	winner: 'home' | 'away' | 'draw' | null;
	market: MarketView | null;
}

function cardFromEvent(e: FeedEvent, market: MarketView | null): Card {
	return {
		key: `${e.provider}:${e.eventId}`,
		eventId: e.eventId,
		sport: e.sport,
		league: e.league,
		leagueLogo: e.leagueLogo,
		startTime: e.startTime,
		feedStatus: e.status,
		home: { name: e.home.name, abbr: e.home.abbr, logo: e.home.logo },
		away: { name: e.away.name, abbr: e.away.abbr, logo: e.away.logo },
		homeScore: e.homeScore,
		awayScore: e.awayScore,
		winner: e.winner,
		market
	};
}

// A market whose game has dropped out of the feed window — render from the
// snapshot so results stay visible and admins can still settle it.
function cardFromMarket(m: MarketView): Card {
	return {
		key: `${m.provider}:${m.eventId}`,
		eventId: m.eventId,
		sport: m.sport,
		league: m.league,
		leagueLogo: null,
		startTime: m.startTime,
		feedStatus: null,
		home: { name: m.homeName, abbr: m.homeAbbr, logo: null },
		away: { name: m.awayName, abbr: m.awayAbbr, logo: null },
		homeScore: null,
		awayScore: null,
		winner: m.winningSide,
		market: m
	};
}

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const feed = getFeed();
	const [events, markets] = await Promise.all([
		feed.listUpcoming().then(dedupeEvents),
		listMarketViews(userId)
	]);

	const marketByEvent = new Map(markets.map((m) => [m.eventId, m]));
	const matched = new Set<string>();
	const cards: Card[] = [];
	for (const e of events) {
		const m = marketByEvent.get(e.eventId) ?? null;
		if (m) matched.add(e.eventId);
		cards.push(cardFromEvent(e, m));
	}
	// Markets for games no longer in the feed (e.g. already final and dropped).
	for (const m of markets) {
		if (!matched.has(m.eventId)) cards.push(cardFromMarket(m));
	}

	// Active (open/closed/no-market) first, then settled; each by kickoff.
	const settled = (c: Card) => c.market?.status === 'resolved' || c.market?.status === 'void';
	cards.sort(
		(a, b) =>
			Number(settled(a)) - Number(settled(b)) || Date.parse(a.startTime) - Date.parse(b.startTime)
	);

	const sports = [...new Set(cards.map((c) => c.sport))].sort();
	return { provider: feed.provider, cards, sports, isAdmin: locals.user!.role === 'admin' };
};

function requireAdmin(locals: App.Locals) {
	if (locals.user?.role !== 'admin') throw error(403, 'Admin access required');
}

export const actions: Actions = {
	// Admin: open a parimutuel market for a feed game.
	openMarket: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const eventId = String(form.get('eventId') ?? '');
		const event = await getFeed().getEvent(eventId);
		if (!event) return fail(404, { message: 'Game not found in the feed', eventId });
		await openMarketFromEvent(event, locals.user!.id);
		return { ok: 'opened' as const };
	},

	// Any signed-in user: place / replace a wager on an open market.
	placeWager: async ({ request, locals }) => {
		const form = await request.formData();
		const marketId = String(form.get('marketId') ?? '');
		const side = String(form.get('side') ?? '') as WagerSide;
		const stake = Number(form.get('stake'));
		try {
			await placeWager({ marketId, userId: locals.user!.id, side, stake });
			return { ok: 'placed' as const, marketId };
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { message: e.message, marketId });
			throw e;
		}
	},

	// Admin: settle from the live feed result (final → pay out, postponed/cancelled → void).
	resolveFromFeed: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const marketId = String(form.get('marketId') ?? '');
		try {
			const { outcome } = await resolveMarketFromFeed({ marketId, resolvedBy: locals.user!.id });
			return { ok: outcome, marketId };
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { message: e.message, marketId });
			throw e;
		}
	},

	// Admin: void a market (refund everyone).
	voidMarket: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const marketId = String(form.get('marketId') ?? '');
		const note = String(form.get('note') ?? '').trim() || undefined;
		try {
			await voidMarket({ marketId, resolvedBy: locals.user!.id, note });
			return { ok: 'void' as const, marketId };
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { message: e.message, marketId });
			throw e;
		}
	}
};
