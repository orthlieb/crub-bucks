import { fail, redirect } from '@sveltejs/kit';
import { createBet, getFriends, LedgerError } from '$lib/server/ledger';
import type { BetMode } from '$lib/ledger-math';
import type { Actions, PageServerLoad } from './$types';

const MODES: BetMode[] = ['even_split', 'winner_loser', 'tiered', 'pot', 'custom'];

export const load: PageServerLoad = async ({ locals }) => {
	const friends = await getFriends(locals.user!.id);
	return {
		friends,
		me: { id: locals.user!.id, displayName: locals.user!.displayName }
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const description = String(form.get('description') ?? '').trim() || null;
		const mode = String(form.get('mode') ?? '') as BetMode;
		if (!MODES.includes(mode)) {
			return fail(400, { error: 'Pick a bet type.', title, description });
		}

		try {
			let betId: string;
			if (mode === 'custom') {
				const userIds = form.getAll('participantUserId').map(String);
				const payouts = form.getAll('payoutIfWin').map((v) => Number(v));
				const losses = form.getAll('lossIfLose').map((v) => Number(v));
				if (userIds.length !== payouts.length || userIds.length !== losses.length) {
					return fail(400, { error: 'Mismatched participant data.', title, description });
				}
				const participants = userIds
					.map((u, i) => ({ userId: u, payoutIfWin: payouts[i], lossIfLose: losses[i] }))
					.filter((p) => p.userId);
				betId = await createBet({ mode, title, description, createdBy: userId, participants });
			} else if (mode === 'pot') {
				const stake = Number(form.get('stake'));
				const selected = form.getAll('participantId').map(String).filter(Boolean);
				const participantIds = Array.from(new Set([userId, ...selected]));
				betId = await createBet({
					mode,
					title,
					description,
					createdBy: userId,
					stake,
					participantIds
				});
			} else {
				const pool = Number(form.get('amount'));
				// Creator is always in; plus the friends they checked.
				const selected = form.getAll('participantId').map(String).filter(Boolean);
				const participantIds = Array.from(new Set([userId, ...selected]));
				betId = await createBet({
					mode,
					title,
					description,
					createdBy: userId,
					pool,
					participantIds
				});
			}
			throw redirect(303, `/app/bet/${betId}`);
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message, title, description });
			throw e;
		}
	}
};
