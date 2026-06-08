/**
 * Pure bet-settlement math, kept dependency-free (no db/$env) so it can be
 * unit-tested in isolation. resolveBet() in ledger.ts uses planSettlement().
 */

export interface SettlementParty {
	userId: string;
	/** payout owed (winners) or loss owed (losers) */
	amount: number;
}

export interface SettlementTransfer {
	fromUserId: string;
	toUserId: string;
	amount: number;
}

/**
 * Greedy fan-out: match losers' losses to winners' payouts, largest first,
 * producing a small set of loser→winner transfers. The caller must ensure the
 * two sides sum to the same total; given that, the transfers exactly settle
 * every party (each winner receives their payout, each loser pays their loss).
 */
export function planSettlement(
	winners: SettlementParty[],
	losers: SettlementParty[]
): SettlementTransfer[] {
	const w = winners.map((x) => ({ ...x })).sort((a, b) => b.amount - a.amount);
	const l = losers.map((x) => ({ ...x })).sort((a, b) => b.amount - a.amount);
	const transfers: SettlementTransfer[] = [];
	let li = 0;
	let wi = 0;
	while (li < l.length && wi < w.length) {
		const amount = Math.min(l[li].amount, w[wi].amount);
		if (amount > 0) {
			transfers.push({ fromUserId: l[li].userId, toUserId: w[wi].userId, amount });
		}
		l[li].amount -= amount;
		w[wi].amount -= amount;
		if (l[li].amount === 0) li++;
		if (w[wi].amount === 0) wi++;
	}
	return transfers;
}

// ---------------------------------------------------------------------------
// Pooled-bet share math
//
// All amounts are whole Crub Bucks. Each helper returns signed deltas that sum
// to exactly zero: the winner gets +pool, the losers split −pool per the mode.
// ---------------------------------------------------------------------------

export type BetMode = 'even_split' | 'winner_loser' | 'tiered' | 'pot' | 'custom' | 'odds';

/**
 * Odds mode: each participant wagers a self-chosen `stake`; a single winner
 * takes the whole pot. The winner nets +Σ(other stakes); each loser nets
 * −(their own stake). Equivalent to pot mode with the winner taking the full
 * pot and everyone else nothing, but resolution needs only the winner's id.
 * Returns deltas summing to zero.
 */
export function oddsDeltas(
	stakes: { userId: string; stake: number }[],
	winnerId: string
): ParticipantDelta[] {
	let pot = 0;
	let sawWinner = false;
	for (const s of stakes) {
		if (!Number.isInteger(s.stake) || s.stake < 1) {
			throw new BetMathError('Each wager must be a positive whole CB');
		}
		pot += s.stake;
		if (s.userId === winnerId) sawWinner = true;
	}
	if (!sawWinner) throw new BetMathError('Winner must be a participant');
	return stakes.map((s) => ({
		userId: s.userId,
		delta: s.userId === winnerId ? pot - s.stake : -s.stake
	}));
}

/**
 * Pot mode: each participant buys in for some amount (initial stake + any
 * re-buys = boughtIn). The pot = sum of boughtIn. At resolution the user
 * enters each participant's `winnings` (their share of the pot); the per-person
 * net = winnings − boughtIn. Sum of winnings must equal sum of boughtIn,
 * otherwise it doesn't balance. Returns deltas summing to zero.
 */
export interface PotParty {
	userId: string;
	boughtIn: number;
	winnings: number;
}

export class BetMathError extends Error {}

export function potSplitDeltas(parties: PotParty[]): ParticipantDelta[] {
	let pot = 0;
	let won = 0;
	for (const p of parties) {
		if (!Number.isInteger(p.boughtIn) || p.boughtIn < 0) {
			throw new BetMathError('Buy-ins must be non-negative whole CB');
		}
		if (!Number.isInteger(p.winnings) || p.winnings < 0) {
			throw new BetMathError('Winnings must be non-negative whole CB');
		}
		pot += p.boughtIn;
		won += p.winnings;
	}
	if (pot !== won) {
		throw new BetMathError(`Winnings must total the pot exactly: pot ${pot}, allocated ${won}`);
	}
	return parties.map((p) => ({ userId: p.userId, delta: p.winnings - p.boughtIn }));
}

export interface ParticipantDelta {
	userId: string;
	delta: number;
}

/**
 * Split `total` into integer parts proportional to `weights`, summing to
 * exactly `total` (largest-remainder method). Used for both even splits
 * (equal weights) and tiered splits (weights 1,2,…,L).
 */
export function allocate(total: number, weights: number[]): number[] {
	const sumW = weights.reduce((a, b) => a + b, 0);
	if (sumW <= 0) return weights.map(() => 0);
	const exact = weights.map((w) => (total * w) / sumW);
	const parts = exact.map(Math.floor);
	const rem = total - parts.reduce((a, b) => a + b, 0);
	const byFrac = exact
		.map((e, i) => ({ i, frac: e - Math.floor(e) }))
		.sort((a, b) => b.frac - a.frac);
	for (let k = 0; k < rem && k < byFrac.length; k++) parts[byFrac[k].i] += 1;
	return parts;
}

/** Even split: winner +pool, every loser pays an equal share of pool. */
export function evenSplitDeltas(
	pool: number,
	winnerId: string,
	loserIds: string[]
): ParticipantDelta[] {
	const losses = allocate(
		pool,
		loserIds.map(() => 1)
	);
	return [
		{ userId: winnerId, delta: pool },
		...loserIds.map((id, i) => ({ userId: id, delta: -losses[i] }))
	];
}

/** Winner takes pool, the single loser pays it; everyone else nets zero. */
export function winnerLoserDeltas(
	pool: number,
	winnerId: string,
	loserId: string,
	zeroIds: string[]
): ParticipantDelta[] {
	return [
		{ userId: winnerId, delta: pool },
		{ userId: loserId, delta: -pool },
		...zeroIds.map((id) => ({ userId: id, delta: 0 }))
	];
}

/**
 * Tiered loss: winner +pool. `orderedLoserIds` runs from the loser who pays
 * the LEAST (rank 1) to the one who pays the MOST (rank L); shares are
 * proportional to rank, so denom = L(L+1)/2. e.g. 2 losers → 1/3, 2/3 of pool;
 * 3 losers → 1/6, 2/6, 3/6.
 */
export function tieredDeltas(
	pool: number,
	winnerId: string,
	orderedLoserIds: string[]
): ParticipantDelta[] {
	const weights = orderedLoserIds.map((_, i) => i + 1);
	const losses = allocate(pool, weights);
	return [
		{ userId: winnerId, delta: pool },
		...orderedLoserIds.map((id, i) => ({ userId: id, delta: -losses[i] }))
	];
}
