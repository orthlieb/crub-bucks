import { fail, redirect } from '@sveltejs/kit';
import { getFeed, dedupeEvents } from '$lib/server/sports';
import {
	openMarketFromEvent,
	placeWager,
	MarketError,
	type WagerSide
} from '$lib/server/sports/markets';
import { db } from '$lib/server/db';
import { sportMarkets } from '$lib/server/db/schema';
import { userBalance } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

/**
 * Pick a game and place the first wager — which opens the market. Lists upcoming
 * feed games that don't have a market yet (games with one already live show on
 * the Sports list, where you can bet via the detail page).
 */
export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const feed = getFeed();
	const [events, balance, existing] = await Promise.all([
		feed.listUpcoming().then(dedupeEvents),
		userBalance(userId),
		db.select({ eventId: sportMarkets.eventId }).from(sportMarkets)
	]);
	const haveMarket = new Set(existing.map((e) => e.eventId));
	const now = Date.now();
	const games = events
		.filter(
			(e) => !haveMarket.has(e.eventId) && e.status === 'scheduled' && Date.parse(e.startTime) > now
		)
		.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime))
		.map((e) => ({
			eventId: e.eventId,
			sport: e.sport,
			league: e.league,
			leagueLogo: e.leagueLogo,
			startTime: e.startTime,
			home: { name: e.home.name, abbr: e.home.abbr, logo: e.home.logo },
			away: { name: e.away.name, abbr: e.away.abbr, logo: e.away.logo }
		}));
	const sports = [...new Set(games.map((g) => g.sport))].sort();
	const leagues = [...new Set(games.map((g) => g.league))].sort();
	return { provider: feed.provider, games, sports, leagues, balance };
};

export const actions: Actions = {
	bet: async ({ request, locals }) => {
		const form = await request.formData();
		const eventId = String(form.get('eventId') ?? '');
		const side = String(form.get('side') ?? '') as WagerSide;
		const stake = Number(form.get('stake'));

		const event = await getFeed().getEvent(eventId);
		if (!event) return fail(404, { message: 'Game not found in the feed', eventId });

		let marketId: string;
		try {
			// First bet opens the market; then the wager is recorded.
			marketId = await openMarketFromEvent(event, locals.user!.id);
			await placeWager({ marketId, userId: locals.user!.id, side, stake });
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { message: e.message, eventId });
			throw e;
		}
		throw redirect(303, `/app/sports/${marketId}`);
	}
};
