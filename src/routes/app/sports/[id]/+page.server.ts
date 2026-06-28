import { error, fail, redirect } from '@sveltejs/kit';
import { getFeed } from '$lib/server/sports';
import {
	getMarketView,
	placeWager,
	cancelWager,
	MarketError,
	type WagerSide
} from '$lib/server/sports/markets';
import { userBalance } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

/** Sports market detail — pools/odds, your wager, score, and (while bettable)
 *  the bet form. Wagering is only open before kickoff. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const userId = locals.user!.id;
	const [market, balance] = await Promise.all([
		getMarketView(userId, params.id),
		userBalance(userId)
	]);
	if (!market) throw error(404, 'Market not found');

	// Score: the stored final if settled, otherwise the live in-play score.
	let score: { home: number; away: number } | null =
		market.homeScore !== null && market.awayScore !== null
			? { home: market.homeScore, away: market.awayScore }
			: null;
	if (!score && market.status === 'open') {
		try {
			const ev = await getFeed().getEvent(market.eventId);
			if (ev && ev.homeScore !== null && ev.awayScore !== null) {
				score = { home: ev.homeScore, away: ev.awayScore };
			}
		} catch {
			// feed down — no live score this load
		}
	}

	// Wagering is open only before kickoff (the cron settles after the game ends).
	const bettable = market.status === 'open' && Date.parse(market.startTime) > Date.now();
	return { market, balance, score, bettable };
};

export const actions: Actions = {
	placeWager: async ({ request, locals, params }) => {
		const form = await request.formData();
		const side = String(form.get('side') ?? '') as WagerSide;
		const stake = Number(form.get('stake'));
		try {
			await placeWager({ marketId: params.id, userId: locals.user!.id, side, stake });
			return { ok: true as const };
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { message: e.message });
			throw e;
		}
	},

	cancelWager: async ({ locals, params }) => {
		try {
			const { marketRemoved } = await cancelWager({
				marketId: params.id,
				userId: locals.user!.id
			});
			// If the cancel emptied the market it's been scrapped — the detail page
			// would 404, so send the user back to the list.
			if (marketRemoved) throw redirect(303, '/app/sports');
			return { ok: true as const };
		} catch (e) {
			if (e instanceof MarketError) return fail(400, { message: e.message });
			throw e;
		}
	}
};
