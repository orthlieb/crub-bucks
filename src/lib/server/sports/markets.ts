import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import { sportMarkets, sportWagers } from '../db/schema';
import { transferInTx, getOrCreateUserWallet, userBalance } from '../ledger';
import { parimutuelDeltas, planSettlement } from '../../ledger-math';
import { createNotification } from '../notifications';
import { getFeed } from './index';
import type { FeedAdapter, FeedEvent } from './types';

type MarketRow = typeof sportMarkets.$inferSelect;

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

// 'draw' is a possible game RESULT (soccer), but never a wager side — a drawn
// game simply pushes (no draw backers ⇒ all-zero deltas ⇒ refund). Keeping it
// out of the betting options keeps the UX simple.
export type WagerSide = 'home' | 'away' | 'draw';

/** Outcomes a user can back: home or away only. A draw is a push. */
export function allowedSides(): WagerSide[] {
	return ['home', 'away'];
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
			homeLogo: event.home.logo,
			awayLogo: event.away.logo,
			leagueLogo: event.leagueLogo,
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
	if (!allowedSides().includes(opts.side)) {
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
	resolvedBy: string | null;
	note?: string;
	homeScore?: number | null;
	awayScore?: number | null;
}): Promise<{ userId: string; delta: number }[]> {
	return db.transaction(async (tx) => {
		// FOR UPDATE: lock the market row so two concurrent settlers (e.g. the
		// cron and an admin click) can't both pay out — the second blocks, then
		// sees status 'resolved' and bails.
		const [market] = await tx
			.select()
			.from(sportMarkets)
			.where(eq(sportMarkets.id, opts.marketId))
			.for('update')
			.limit(1);
		if (!market) throw new MarketError('Market not found');
		if (market.status === 'resolved' || market.status === 'void') {
			throw new MarketError('Market is already settled');
		}

		const wagers = await tx
			.select()
			.from(sportWagers)
			.where(eq(sportWagers.marketId, opts.marketId));

		// No opposing bets by settlement (one side only, or empty) → a push:
		// parimutuel can't pay out without a losing pool, so refund everyone and
		// mark the market void.
		const distinctSides = new Set(wagers.map((w) => w.side));
		if (distinctSides.size < 2) {
			for (const w of wagers) {
				await tx
					.update(sportWagers)
					.set({ settledDelta: 0 })
					.where(and(eq(sportWagers.marketId, opts.marketId), eq(sportWagers.userId, w.userId)));
			}
			await tx
				.update(sportMarkets)
				.set({
					status: 'void',
					resolvedAt: new Date(),
					resolvedBy: opts.resolvedBy,
					resolutionNote: opts.note ?? 'No opposing bets — pushed',
					homeScore: opts.homeScore ?? null,
					awayScore: opts.awayScore ?? null
				})
				.where(eq(sportMarkets.id, opts.marketId));
			return wagers.map((w) => ({ userId: w.userId, delta: 0 }));
		}

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
				createdBy: opts.resolvedBy,
				sportMarketId: opts.marketId
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
				resolutionNote: opts.note ?? null,
				homeScore: opts.homeScore ?? null,
				awayScore: opts.awayScore ?? null
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
	resolvedBy: string | null;
	note?: string;
}): Promise<string[]> {
	return db.transaction(async (tx) => {
		const [market] = await tx
			.select({ status: sportMarkets.status })
			.from(sportMarkets)
			.where(eq(sportMarkets.id, opts.marketId))
			.for('update')
			.limit(1);
		if (!market) throw new MarketError('Market not found');
		if (market.status === 'resolved' || market.status === 'void') {
			throw new MarketError('Market is already settled');
		}
		const refunded = await tx
			.select({ userId: sportWagers.userId })
			.from(sportWagers)
			.where(eq(sportWagers.marketId, opts.marketId));
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
		return refunded.map((r) => r.userId);
	});
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

export interface MarketView {
	id: string;
	provider: string;
	eventId: string;
	sport: string;
	league: string;
	homeName: string;
	homeAbbr: string;
	awayName: string;
	awayAbbr: string;
	homeLogo: string | null;
	awayLogo: string | null;
	leagueLogo: string | null;
	/** ISO-8601, serializable for the loader payload. */
	startTime: string;
	status: 'open' | 'closed' | 'resolved' | 'void';
	winningSide: WagerSide | null;
	resolutionNote: string | null;
	/** Final score, stored at settlement (null while open / for no-score voids). */
	homeScore: number | null;
	awayScore: number | null;
	pools: MarketPool[];
	/** The requesting user's own wager on this market, if any. */
	myWager: { side: WagerSide; stake: number; settledDelta: number | null } | null;
}

type WagerRow = typeof sportWagers.$inferSelect;

/** Fold a market row + its wagers into the view model (pools + my wager). */
function toMarketView(m: MarketRow, wagers: WagerRow[], userId: string): MarketView {
	const pools = new Map<string, { total: number; count: number }>();
	let mine: MarketView['myWager'] = null;
	for (const w of wagers) {
		const cur = pools.get(w.side) ?? { total: 0, count: 0 };
		cur.total += w.stake;
		cur.count += 1;
		pools.set(w.side, cur);
		if (w.userId === userId) {
			mine = { side: w.side as WagerSide, stake: w.stake, settledDelta: w.settledDelta };
		}
	}
	return {
		id: m.id,
		provider: m.provider,
		eventId: m.eventId,
		sport: m.sport,
		league: m.league,
		homeName: m.homeName,
		homeAbbr: m.homeAbbr,
		awayName: m.awayName,
		awayAbbr: m.awayAbbr,
		homeLogo: m.homeLogo,
		awayLogo: m.awayLogo,
		leagueLogo: m.leagueLogo,
		startTime: m.startTime.toISOString(),
		status: m.status,
		winningSide: m.winningSide as WagerSide | null,
		resolutionNote: m.resolutionNote,
		homeScore: m.homeScore,
		awayScore: m.awayScore,
		pools: [...pools.entries()].map(([side, v]) => ({
			side: side as WagerSide,
			total: v.total,
			count: v.count
		})),
		myWager: mine
	};
}

/**
 * All markets (recent first) with their per-side pools and the requesting
 * user's own wager folded in — the read model the Sports list renders from.
 */
export async function listMarketViews(userId: string): Promise<MarketView[]> {
	const markets = await db
		.select()
		.from(sportMarkets)
		.orderBy(desc(sportMarkets.startTime))
		.limit(200);
	if (markets.length === 0) return [];

	const ids = markets.map((m) => m.id);
	const wagers = await db.select().from(sportWagers).where(inArray(sportWagers.marketId, ids));
	const byMarket = new Map<string, WagerRow[]>();
	for (const w of wagers) {
		const arr = byMarket.get(w.marketId) ?? [];
		arr.push(w);
		byMarket.set(w.marketId, arr);
	}
	return markets.map((m) => toMarketView(m, byMarket.get(m.id) ?? [], userId));
}

/** A single market view by id, or null if it doesn't exist. */
export async function getMarketView(userId: string, marketId: string): Promise<MarketView | null> {
	const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId)).limit(1);
	if (!m) return null;
	const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
	return toMarketView(m, wagers, userId);
}

// ---------------------------------------------------------------------------
// Auto-resolution
// ---------------------------------------------------------------------------

export interface SettleSummary {
	resolved: number;
	voided: number;
	/** Started markets with no wagers at all — deleted outright. */
	scrapped: number;
	skipped: number;
	errors: number;
}

const matchupOf = (m: MarketRow) => `${m.homeAbbr} vs ${m.awayAbbr}`;

/** Tell each backer how their bet settled. Best-effort — never blocks/throws. */
async function notifyResolved(m: MarketRow, deltas: { userId: string; delta: number }[]) {
	const matchup = matchupOf(m);
	for (const d of deltas) {
		if (d.delta === 0) continue; // no movement (push / break-even) — stay quiet
		const won = d.delta > 0;
		await createNotification({
			userId: d.userId,
			level: won ? 'success' : 'info',
			title: won ? 'You won a sports bet' : 'Sports bet settled',
			body: `${won ? '+' : '-'}${Math.abs(d.delta)} CB on ${matchup}`,
			link: '/app/sports'
		}).catch(() => {});
	}
}

async function notifyVoided(m: MarketRow, userIds: string[]) {
	const matchup = matchupOf(m);
	for (const userId of userIds) {
		await createNotification({
			userId,
			level: 'info',
			title: 'Sports market voided',
			body: `${matchup} was called off — your wager was refunded.`,
			link: '/app/sports'
		}).catch(() => {});
	}
}

/**
 * Settle every market whose game has started and now has a feed result:
 * final → resolve on the derived winner, postponed/cancelled → void. Fetches
 * the feed ONCE and matches by eventId. Each market settles in its own
 * transaction, so one bad game can't abort the batch; backers are notified of
 * their outcome. Games that have aged out of the feed window are skipped (the
 * admin "Resolve from feed" button is the backstop). Idempotent: a settled
 * market is no longer a candidate, and the row lock in resolveMarket guards
 * against any concurrent settler. `feed`/`now` are injectable for testing.
 */
export async function settleDueMarkets(opts?: {
	feed?: FeedAdapter;
	now?: Date;
}): Promise<SettleSummary> {
	const feed = opts?.feed ?? getFeed();
	const now = opts?.now ?? new Date();
	const summary: SettleSummary = { resolved: 0, voided: 0, scrapped: 0, skipped: 0, errors: 0 };

	const candidates = await db
		.select()
		.from(sportMarkets)
		.where(and(inArray(sportMarkets.status, ['open', 'closed']), lte(sportMarkets.startTime, now)));
	if (candidates.length === 0) return summary;

	// Scrap markets that reached kickoff with no bettors at all — delete them
	// outright (feed-independent; nothing to settle or refund). The rest go on
	// to feed-based settlement.
	const candidateIds = candidates.map((c) => c.id);
	const wagered = await db
		.select({ marketId: sportWagers.marketId })
		.from(sportWagers)
		.where(inArray(sportWagers.marketId, candidateIds));
	const hasWagers = new Set(wagered.map((w) => w.marketId));
	const live: MarketRow[] = [];
	for (const m of candidates) {
		if (hasWagers.has(m.id)) {
			live.push(m);
			continue;
		}
		try {
			await db.delete(sportMarkets).where(eq(sportMarkets.id, m.id));
			summary.scrapped++;
		} catch {
			summary.errors++;
		}
	}
	if (live.length === 0) return summary;

	let events: FeedEvent[];
	try {
		events = await feed.listUpcoming();
	} catch {
		return summary; // feed unreachable — leave everything for the next tick
	}
	const byId = new Map(events.map((e) => [e.eventId, e]));

	for (const m of live) {
		try {
			const ev = byId.get(m.eventId);
			if (!ev) {
				summary.skipped++; // game no longer in the feed window — admin backstop
				continue;
			}
			if (ev.status === 'postponed' || ev.status === 'cancelled') {
				const refunded = await voidMarket({
					marketId: m.id,
					resolvedBy: null,
					note: `Auto-voided: game ${ev.status}`
				});
				await notifyVoided(m, refunded);
				summary.voided++;
			} else if (ev.status === 'final' && ev.winner !== null) {
				const deltas = await resolveMarket({
					marketId: m.id,
					winningSide: ev.winner,
					resolvedBy: null,
					note: 'Auto-resolved from feed',
					homeScore: ev.homeScore,
					awayScore: ev.awayScore
				});
				await notifyResolved(m, deltas);
				summary.resolved++;
			} else {
				summary.skipped++; // still scheduled / in progress
			}
		} catch {
			summary.errors++;
		}
	}
	return summary;
}
