import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bets, betParticipants, users } from '$lib/server/db/schema';
import {
	resolveBet,
	cancelBet,
	acceptBet,
	declineBet,
	isBetParticipant,
	rebuy,
	LedgerError
} from '$lib/server/ledger';
import { checkClean } from '$lib/server/moderation';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.user!.id;
	const betId = params.bid;

	const [bet] = await db
		.select({
			id: bets.id,
			title: bets.title,
			icon: bets.icon,
			status: bets.status,
			mode: bets.mode,
			pool: bets.pool,
			stake: bets.stake,
			createdBy: bets.createdBy,
			createdAt: bets.createdAt,
			resolvedAt: bets.resolvedAt,
			resolutionNote: bets.resolutionNote
		})
		.from(bets)
		.where(eq(bets.id, betId));
	if (!bet) throw error(404, 'Bet not found');

	// Only participants can view a bet.
	if (!(await isBetParticipant(betId, userId))) throw error(404, 'Bet not found');

	const participants = await db
		.select({
			userId: betParticipants.userId,
			displayName: users.displayName,
			payoutIfWin: betParticipants.payoutIfWin,
			lossIfLose: betParticipants.lossIfLose,
			outcome: betParticipants.outcome,
			settledDelta: betParticipants.settledDelta,
			lossRank: betParticipants.lossRank,
			boughtIn: betParticipants.boughtIn,
			acceptedAt: betParticipants.acceptedAt
		})
		.from(betParticipants)
		.innerJoin(users, eq(users.id, betParticipants.userId))
		.where(eq(betParticipants.betId, betId));

	const [creator] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, bet.createdBy));

	return {
		bet,
		participants,
		creatorName: creator?.displayName ?? 'Unknown',
		myUserId: userId
	};
};

export const actions: Actions = {
	resolve: async ({ params, request, locals }) => {
		const userId = locals.user!.id;
		const betId = params.bid;
		if (!(await isBetParticipant(betId, userId))) throw error(403, 'Not a participant');

		const form = await request.formData();
		const note = String(form.get('note') ?? '').trim() || null;
		const noteClean = checkClean(note, 'note');
		if (!noteClean.ok) return fail(400, { error: noteClean.message });
		const winnerId = String(form.get('winnerId') ?? '') || undefined;
		const loserId = String(form.get('loserId') ?? '') || undefined;
		// tiered: ordered loser ids (least → most), comma-separated hidden field
		const orderRaw = String(form.get('loserOrder') ?? '').trim();
		const loserOrder = orderRaw ? orderRaw.split(',').filter(Boolean) : undefined;
		// custom: outcome[<userId>] = won | lost
		const outcomes: Record<string, 'won' | 'lost'> = {};
		// pot: winnings[<userId>] = number
		const winnings: Record<string, number> = {};
		// tie-split: manual[<userId>] = signed net delta
		const manualRaw: Record<string, number> = {};
		let hasManual = false;
		for (const [key, value] of form.entries()) {
			const m = /^outcome\[(.+)\]$/.exec(key);
			if (m) {
				const v = String(value);
				if (v === 'won' || v === 'lost') outcomes[m[1]] = v;
			}
			const w = /^winnings\[(.+)\]$/.exec(key);
			if (w) winnings[w[1]] = Number(value);
			const mm = /^manual\[(.+)\]$/.exec(key);
			if (mm) {
				manualRaw[mm[1]] = Number(value);
				hasManual = true;
			}
		}

		try {
			await resolveBet({
				betId,
				resolvedBy: userId,
				note,
				winnerId,
				loserId,
				loserOrder,
				outcomes,
				winnings,
				manual: hasManual ? manualRaw : undefined
			});
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message });
			throw e;
		}
		throw redirect(303, `/app/bet/${betId}`);
	},

	rebuy: async ({ params, request, locals }) => {
		const userId = locals.user!.id;
		const betId = params.bid;
		if (!(await isBetParticipant(betId, userId))) throw error(403, 'Not a participant');

		const form = await request.formData();
		const amount = Number(form.get('amount'));
		try {
			await rebuy({ betId, userId, amount, requestedBy: userId });
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message });
			throw e;
		}
		throw redirect(303, `/app/bet/${betId}`);
	},

	cancel: async ({ params, locals }) => {
		const userId = locals.user!.id;
		const betId = params.bid;
		if (!(await isBetParticipant(betId, userId))) throw error(403, 'Not a participant');

		try {
			await cancelBet({ betId, cancelledBy: userId });
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message });
			throw e;
		}
		throw redirect(303, `/app/bet/${betId}`);
	},

	accept: async ({ params, request, locals }) => {
		const userId = locals.user!.id;
		const betId = params.bid;
		if (!(await isBetParticipant(betId, userId))) throw error(403, 'Not a participant');

		// Odds bets carry the accepting player's own wager; other modes ignore it.
		const form = await request.formData();
		const stakeRaw = form.get('stake');
		const stake =
			stakeRaw != null && String(stakeRaw).trim() !== '' ? Number(stakeRaw) : undefined;

		try {
			await acceptBet({ betId, userId, stake });
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message });
			throw e;
		}
		throw redirect(303, `/app/bet/${betId}`);
	},

	decline: async ({ params, locals }) => {
		const userId = locals.user!.id;
		const betId = params.bid;
		if (!(await isBetParticipant(betId, userId))) throw error(403, 'Not a participant');

		try {
			await declineBet({ betId, userId });
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message });
			throw e;
		}
		throw redirect(303, `/app/bet/${betId}`);
	}
};
