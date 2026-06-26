import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { sportMarkets, sportWagers } from '../db/schema';
import { transferInTx, getOrCreateUserWallet, userBalance } from '../ledger';
import { parimutuelDeltas, planSettlement } from '../../ledger-math';
import { getFeed } from './index';
import type { FeedEvent } from './types';

/**
 * Sports betting engine — parimutuel markets bound to a feed event.
 *
 * The pure payout math lives in ledger-math.ts (parimutuelDeltas); the
 * zero-sum money movement reuses the same ledger primitives as peer bets
 * (transferInTx + planSettlement). Everything that touches money runs inside a
 * single db.transaction so a market either settles completely or not at all.
 *
 * Invariants preserved: integers only, no escrow (CB moves only at
 * resolution), and every settlement nets to zero.
 */

export class MarketError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'MarketError';
	}
}

export type WagerSide = 'home' | 'away' | 'draw';

/** Which outcomes can be backed for a sport. Only soccer can end in a draw. */
export function allowedSides(sport: string): WagerSide[] {
	return sport === 'soccer' ? ['home', 'away', 'draw'] : ['home', 'away'];
}

/**
 * Create (or fetch) the market for a feed event. Idempotent on (provider,
 * eventId) so opening the same game twice is safe. Returns the market id.
 */
export async function openMarketFromEvent(event: FeedEvent, createdBy: string): Promise<string> {
	const inserted = await db
		.insert(sportMarkets)
		.values({
			provider: event.provider,
			eventId: event.eventId,
			sport: event.sport,
			league: event.league,
			homeName: event.home.name,
			homeAbbr: event.home.abbr,
			awayName: event.away.name,
			awayAbbr: event.away.abbr,
			startTime: new Date(event.startTime),
			status: 'open',
			createdBy
		})
		.onConflictDoNothing({ target: [sportMarkets.provider, sportMarkets.eventId] })
		.returning({ id: sportMarkets.id });
	if (inserted[0]) return inserted[0].id;

	const [existing] = await db
		.select({ id: sportMarkets.id })
		.from(sportMarkets)
		.where(and(eq(sportMarkets.provider, event.provider), eq(sportMarkets.eventId, event.eventId)))
		.limit(1);
	if (!existing) throw new MarketError('Market could not be created');
	return existing.id;
}

/**
 * Place (or replace) the caller's wager on an open market. Enforces: market is
 * open and before kickoff, the side is valid for the sport, the stake is a
 * positive whole CB, and the stake does not exceed the user's current balance
 * (no escrow — the cap is a guard, money only moves at resolution).
 */
export async function placeWager(opts: {
	marketId: string;
	userId: string;
	side: WagerSide;
	stake: number;
	now?: Date;
}): Promise<void> {
	const now = opts.now ?? new Date();
	if (!Number.isInteger(opts.stake) || opts.stake < 1) {
		throw new MarketError('Stake must be a positive whole number of Crub Bucks');
	}

	const [market] = await db
		.select()
		.from(sportMarkets)
		.where(eq(sportMarkets.id, opts.marketId))
		.limit(1);
	if (!market) throw new MarketError('Market not found');
	if (market.status !== 'open') throw new MarketError('This market is closed to new wagers');
	if (now >= market.startTime) throw new MarketError('Wagering has closed for this game');
	if (!allowedSides(market.sport).includes(opts.side)) {
		throw new MarketError(`"${opts.side}" is not a valid pick for this game`);
	}

	const balance = await userBalance(opts.userId);
	if (opts.stake > balance) {
		throw new MarketError(`Stake exceeds your balance of ${balance} CB`);
	}

	await db
		.insert(sportWagers)
		.values({ marketId: opts.marketId, userId: opts.userId, side: opts.side, stake: opts.stake })
		.onConflictDoUpdate({
			target: [sportWagers.marketId, sportWagers.userId],
			set: { side: opts.side, stake: opts.stake, placedAt: now }
		});
}

/**
 * Settle a market on a known outcome. Backers of `winningSide` split the
 * losers' pool proportionally; everyone else loses their stake. A push (nobody
 * backed the result, or everybody did) yields all-zero deltas and no transfers.
 * Returns the per-user signed nets.
 */
export async function resolveMarket(opts: {
	marketId: string;
	winningSide: WagerSide;
	resolvedBy: string;
	note?: string;
}): Promise<{ userId: string; delta: number }[]> {
	return db.transaction(async (tx) => {
		const [market] = await tx
			.select()
			.from(sportMarkets)
			.where(eq(sportMarkets.id, opts.marketId))
			.limit(1);
		if (!market) throw new MarketError('Market not found');
		if (market.status === 'resolved' || market.status === 'void') {
			throw new MarketError('Market is already settled');
		}

		const wagers = await tx
			.select()
			.from(sportWagers)
			.where(eq(sportWagers.marketId, opts.marketId));

		const deltas = parimutuelDeltas(
			wagers.map((w) => ({ userId: w.userId, side: w.side, stake: w.stake })),
			opts.winningSide
		);

		// Move the money: losers → winners, fewest transfers (same machinery as
		// peer-bet resolution).
		const plan = planSettlement(
			deltas.filter((d) => d.delta > 0).map((d) => ({ userId: d.userId, amount: d.delta })),
			deltas.filter((d) => d.delta < 0).map((d) => ({ userId: d.userId, amount: -d.delta }))
		);
		const walletByUser = new Map<string, string>();
		for (const d of deltas) {
			walletByUser.set(d.userId, await getOrCreateUserWallet(d.userId, tx));
		}
		const memo = `Sports: ${market.homeAbbr} vs ${market.awayAbbr}`;
		for (const t of plan) {
			await transferInTx(tx, {
				fromWalletId: walletByUser.get(t.fromUserId)!,
				toWalletId: walletByUser.get(t.toUserId)!,
				amount: t.amount,
				memo,
				createdBy: opts.resolvedBy
			});
		}

		// Record each wager's net, then close the market.
		for (const d of deltas) {
			await tx
				.update(sportWagers)
				.set({ settledDelta: d.delta })
				.where(and(eq(sportWagers.marketId, opts.marketId), eq(sportWagers.userId, d.userId)));
		}
		await tx
			.update(sportMarkets)
			.set({
				status: 'resolved',
				winningSide: opts.winningSide,
				resolvedAt: new Date(),
				resolvedBy: opts.resolvedBy,
				resolutionNote: opts.note ?? null
			})
			.where(eq(sportMarkets.id, opts.marketId));

		return deltas;
	});
}

/**
 * Void a market — no money moves, every wager settles to zero. For postponed /
 * cancelled games (or a manual call-off).
 */
export async function voidMarket(opts: {
	marketId: string;
	resolvedBy: string;
	note?: string;
}): Promise<void> {
	await db.transaction(async (tx) => {
		const [market] = await tx
			.select({ status: sportMarkets.status })
			.from(sportMarkets)
			.where(eq(sportMarkets.id, opts.marketId))
			.limit(1);
		if (!market) throw new MarketError('Market not found');
		if (market.status === 'resolved' || market.status === 'void') {
			throw new MarketError('Market is already settled');
		}
		await tx
			.update(sportWagers)
			.set({ settledDelta: 0 })
			.where(eq(sportWagers.marketId, opts.marketId));
		await tx
			.update(sportMarkets)
			.set({
				status: 'void',
				resolvedAt: new Date(),
				resolvedBy: opts.resolvedBy,
				resolutionNote: opts.note ?? null
			})
			.where(eq(sportMarkets.id, opts.marketId));
	});
}

/**
 * Settle a market straight from the live feed: a final game resolves on its
 * derived winner; a postponed/cancelled game voids; anything else is rejected
 * because there's no result yet.
 */
export async function resolveMarketFromFeed(opts: {
	marketId: string;
	resolvedBy: string;
	note?: string;
}): Promise<{ outcome: 'resolved' | 'void' }> {
	const [market] = await db
		.select()
		.from(sportMarkets)
		.where(eq(sportMarkets.id, opts.marketId))
		.limit(1);
	if (!market) throw new MarketError('Market not found');

	const event = await getFeed().getEvent(market.eventId);
	if (!event) throw new MarketError('Game not found in the feed');

	if (event.status === 'postponed' || event.status === 'cancelled') {
		await voidMarket({ marketId: opts.marketId, resolvedBy: opts.resolvedBy, note: opts.note });
		return { outcome: 'void' };
	}
	if (event.status !== 'final' || event.winner === null) {
		throw new MarketError('This game has no final result yet');
	}
	await resolveMarket({
		marketId: opts.marketId,
		winningSide: event.winner,
		resolvedBy: opts.resolvedBy,
		note: opts.note
	});
	return { outcome: 'resolved' };
}

export interface MarketPool {
	side: WagerSide;
	total: number;
	count: number;
}

/** Per-side pool totals + backer counts, for the market UI / payout preview. */
export async function poolsBySide(marketId: string): Promise<MarketPool[]> {
	const rows = await db
		.select({
			side: sportWagers.side,
			total: sql<number>`coalesce(sum(${sportWagers.stake}), 0)`,
			count: sql<number>`count(*)`
		})
		.from(sportWagers)
		.where(eq(sportWagers.marketId, marketId))
		.groupBy(sportWagers.side);
	return rows.map((r) => ({
		side: r.side as WagerSide,
		total: Number(r.total),
		count: Number(r.count)
	}));
}
