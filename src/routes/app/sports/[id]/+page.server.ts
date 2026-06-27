import { error, fail } from '@sveltejs/kit';
import { getMarketView, placeWager, MarketError, type WagerSide } from '$lib/server/sports/markets';
import { userBalance } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

/** Sports market detail — pools/odds, your wager, and (while open) the bet form. */
export const load: PageServerLoad = async ({ locals, params }) => {
	const userId = locals.user!.id;
	const [market, balance] = await Promise.all([
		getMarketView(userId, params.id),
		userBalance(userId)
	]);
	if (!market) throw error(404, 'Market not found');
	return { market, balance };
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
	}
};
