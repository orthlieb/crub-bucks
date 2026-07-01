import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { sportMarkets, sportWagers, notifications, ledgerEntries } from '../db/schema';
import { resetDb, createUser } from '../../../test/db';
import { issueFromBank, userBalance, establishFriendship } from '../ledger';
import { getFeed } from '../feed';
import {
	openMarketFromEvent,
	placeWager,
	cancelWager,
	resolveMarket,
	voidMarket,
	poolsBySide,
	backersBySide,
	settleDueMarkets,
	MarketError
} from './markets';
import type { FeedAdapter, FeedEvent } from './types';

/** A fixed in-memory feed for the auto-resolution tests. */
function stubFeed(events: FeedEvent[]): FeedAdapter {
	return {
		provider: 'stub',
		listUpcoming: async () => events,
		getEvent: async (id: string) => events.find((e) => e.eventId === id) ?? null
	};
}
const FUTURE = () => new Date(Date.now() + 7 * 24 * 3600 * 1000); // past every market's kickoff

beforeEach(resetDb);

let evCounter = 0;
function makeEvent(over: Partial<FeedEvent> = {}): FeedEvent {
	evCounter++;
	return {
		provider: 'mock',
		eventId: `game-${evCounter}`,
		sport: 'soccer',
		league: 'FIFA World Cup',
		leagueLogo: null,
		startTime: new Date(Date.now() + 24 * 3600 * 1000).toISOString(), // tomorrow
		status: 'scheduled',
		home: { id: 'h', name: 'Home', abbr: 'HOM', logo: null },
		away: { id: 'a', name: 'Away', abbr: 'AWY', logo: null },
		homeScore: null,
		awayScore: null,
		winner: null,
		...over
	};
}

/** A user funded with `amount` CB from the Bank. */
async function fundedUser(amount: number) {
	const u = await createUser();
	if (amount > 0) await issueFromBank({ toUserId: u.id, amount, memo: 'test seed' });
	return u;
}

describe('openMarketFromEvent', () => {
	it('creates a market from a feed event and is idempotent', async () => {
		const admin = await createUser();
		const ev = makeEvent();
		const id1 = await openMarketFromEvent(ev, admin.id);
		const id2 = await openMarketFromEvent(ev, admin.id); // same (provider, eventId)
		expect(id1).toBe(id2);

		const rows = await db.select().from(sportMarkets);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ status: 'open', sport: 'soccer', homeAbbr: 'HOM' });
	});
});

describe('backersBySide', () => {
	it('reveals the viewer + friends by name and counts strangers anonymously', async () => {
		const admin = await createUser();
		const me = await fundedUser(100);
		const friend = await fundedUser(100);
		const stranger = await fundedUser(100);
		await establishFriendship(me.id, friend.id);

		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: me.id, side: 'home', stake: 30 });
		await placeWager({ marketId, userId: friend.id, side: 'home', stake: 20 });
		await placeWager({ marketId, userId: stranger.id, side: 'home', stake: 10 });

		const backers = await backersBySide(marketId, me.id);
		const home = backers['home'];
		// Self first, then friend by stake; stranger is anonymous.
		expect(home.friends.map((f) => f.userId)).toEqual([me.id, friend.id]);
		expect(home.friends[0].isSelf).toBe(true);
		expect(home.friends[1].stake).toBe(20);
		expect(home.otherCount).toBe(1);
		// A side with no backers is absent.
		expect(backers['away']).toBeUndefined();
	});
});

describe('placeWager', () => {
	it('records a wager and lets the same user replace it while open', async () => {
		const admin = await createUser();
		const u = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);

		await placeWager({ marketId, userId: u.id, side: 'home', stake: 60 });
		let [w] = await db
			.select()
			.from(sportWagers)
			.where(and(eq(sportWagers.marketId, marketId), eq(sportWagers.userId, u.id)));
		expect(w).toMatchObject({ side: 'home', stake: 60 });

		await placeWager({ marketId, userId: u.id, side: 'away', stake: 80 }); // replace
		[w] = await db
			.select()
			.from(sportWagers)
			.where(and(eq(sportWagers.marketId, marketId), eq(sportWagers.userId, u.id)));
		expect(w).toMatchObject({ side: 'away', stake: 80 });
		// no escrow: balance unchanged by placing a wager
		expect(await userBalance(u.id)).toBe(100);
	});

	it('rejects a stake above the user balance', async () => {
		const admin = await createUser();
		const u = await fundedUser(50);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await expect(
			placeWager({ marketId, userId: u.id, side: 'home', stake: 51 })
		).rejects.toBeInstanceOf(MarketError);
	});

	it('rejects a non-positive / fractional stake', async () => {
		const admin = await createUser();
		const u = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await expect(
			placeWager({ marketId, userId: u.id, side: 'home', stake: 0 })
		).rejects.toBeInstanceOf(MarketError);
		await expect(
			placeWager({ marketId, userId: u.id, side: 'home', stake: 1.5 })
		).rejects.toBeInstanceOf(MarketError);
	});

	it('rejects a draw pick — a drawn game is a push, not a side', async () => {
		const admin = await createUser();
		const u = await fundedUser(100);
		// even for soccer (which can draw), 'draw' is not a backable side
		const marketId = await openMarketFromEvent(makeEvent({ sport: 'soccer' }), admin.id);
		await expect(
			placeWager({ marketId, userId: u.id, side: 'draw', stake: 10 })
		).rejects.toBeInstanceOf(MarketError);
	});

	it('rejects wagering after kickoff', async () => {
		const admin = await createUser();
		const u = await fundedUser(100);
		const marketId = await openMarketFromEvent(
			makeEvent({ startTime: new Date(Date.now() - 3600 * 1000).toISOString() }),
			admin.id
		);
		await expect(
			placeWager({ marketId, userId: u.id, side: 'home', stake: 10 })
		).rejects.toBeInstanceOf(MarketError);
	});
});

describe('cancelWager', () => {
	it('removes the wager and leaves the market when others remain', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 30 });

		const res = await cancelWager({ marketId, userId: a.id });
		expect(res.marketRemoved).toBe(false);

		// a's wager is gone, b's remains, market still open, no money moved
		const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
		expect(wagers).toHaveLength(1);
		expect(wagers[0].userId).toBe(b.id);
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m.status).toBe('open');
		expect(await userBalance(a.id)).toBe(100);
	});

	it('scraps the market when the last wager is cancelled', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });

		const res = await cancelWager({ marketId, userId: a.id });
		expect(res.marketRemoved).toBe(true);
		const markets = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(markets).toHaveLength(0);
	});

	it('rejects cancelling after kickoff', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		// move kickoff into the past
		await db
			.update(sportMarkets)
			.set({ startTime: new Date(Date.now() - 3600 * 1000) })
			.where(eq(sportMarkets.id, marketId));
		await expect(cancelWager({ marketId, userId: a.id })).rejects.toBeInstanceOf(MarketError);
	});

	it('errors when the caller has no wager to cancel', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await expect(cancelWager({ marketId, userId: b.id })).rejects.toBeInstanceOf(MarketError);
	});
});

describe('resolveMarket', () => {
	it('pays winners from the losing pool, proportional to stake, and nets to zero', async () => {
		const admin = await createUser();
		const a = await fundedUser(1000);
		const b = await fundedUser(1000);
		const c = await fundedUser(1000);
		const d = await fundedUser(1000);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);

		await placeWager({ marketId, userId: a.id, side: 'home', stake: 100 });
		await placeWager({ marketId, userId: b.id, side: 'home', stake: 50 });
		await placeWager({ marketId, userId: c.id, side: 'away', stake: 30 });
		await placeWager({ marketId, userId: d.id, side: 'away', stake: 20 });

		await resolveMarket({ marketId, winningSide: 'home', resolvedBy: admin.id });

		// losers' pool = 50, split 100:50 → +33 / +17; losers pay their stake.
		expect(await userBalance(a.id)).toBe(1033);
		expect(await userBalance(b.id)).toBe(1017);
		expect(await userBalance(c.id)).toBe(970);
		expect(await userBalance(d.id)).toBe(980);

		// market + wagers reflect settlement
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m).toMatchObject({ status: 'resolved', winningSide: 'home' });
		const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
		expect(wagers.every((w) => w.settledDelta !== null)).toBe(true);
		expect(wagers.reduce((s, w) => s + (w.settledDelta ?? 0), 0)).toBe(0);
	});

	it('is a push (no money moves) when nobody backed the winning side', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'home', stake: 60 });

		await resolveMarket({ marketId, winningSide: 'away', resolvedBy: admin.id });

		expect(await userBalance(a.id)).toBe(100);
		expect(await userBalance(b.id)).toBe(100);
		const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
		expect(wagers.every((w) => w.settledDelta === 0)).toBe(true);
	});

	it('stores the final score on resolution', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 10 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 10 });
		await resolveMarket({
			marketId,
			winningSide: 'home',
			resolvedBy: admin.id,
			homeScore: 3,
			awayScore: 1
		});
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m.homeScore).toBe(3);
		expect(m.awayScore).toBe(1);
	});

	it('pushes a drawn game — home and away backers both refunded', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent({ sport: 'soccer' }), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 60 });

		await resolveMarket({ marketId, winningSide: 'draw', resolvedBy: admin.id });

		expect(await userBalance(a.id)).toBe(100);
		expect(await userBalance(b.id)).toBe(100);
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m).toMatchObject({ status: 'resolved', winningSide: 'draw' });
		const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
		expect(wagers.every((w) => w.settledDelta === 0)).toBe(true);
	});

	it('pushes (voids + refunds) when only one side has bets by settlement', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		// both on home — no counter-bets
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'home', stake: 30 });

		await resolveMarket({ marketId, winningSide: 'home', resolvedBy: admin.id });

		expect(await userBalance(a.id)).toBe(100); // refunded — no money moved
		expect(await userBalance(b.id)).toBe(100);
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m.status).toBe('void');
		expect(m.resolutionNote).toBe('No bets'); // flagged as No Bets, not a push
		const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
		expect(wagers.every((w) => w.settledDelta === 0)).toBe(true);
	});

	it('refuses to settle a market twice', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 10 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 10 });
		await resolveMarket({ marketId, winningSide: 'home', resolvedBy: admin.id });
		await expect(
			resolveMarket({ marketId, winningSide: 'home', resolvedBy: admin.id })
		).rejects.toBeInstanceOf(MarketError);
	});
});

describe('voidMarket', () => {
	it('refunds everyone (no balance change) and marks the market void', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 60 });

		await voidMarket({ marketId, resolvedBy: admin.id, note: 'postponed' });

		expect(await userBalance(a.id)).toBe(100);
		expect(await userBalance(b.id)).toBe(100);
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m.status).toBe('void');
		const wagers = await db.select().from(sportWagers).where(eq(sportWagers.marketId, marketId));
		expect(wagers.every((w) => w.settledDelta === 0)).toBe(true);
	});
});

describe('poolsBySide', () => {
	it('totals stake and backers per side', async () => {
		const admin = await createUser();
		const a = await fundedUser(1000);
		const b = await fundedUser(1000);
		const c = await fundedUser(1000);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 100 });
		await placeWager({ marketId, userId: b.id, side: 'home', stake: 50 });
		await placeWager({ marketId, userId: c.id, side: 'away', stake: 30 });

		const pools = await poolsBySide(marketId);
		const home = pools.find((p) => p.side === 'home');
		const away = pools.find((p) => p.side === 'away');
		expect(home).toEqual({ side: 'home', total: 150, count: 2 });
		expect(away).toEqual({ side: 'away', total: 30, count: 1 });
	});
});

describe('settleDueMarkets', () => {
	it('resolves a finished game from the feed, notifies backers, and is idempotent', async () => {
		const admin = await createUser();
		const a = await fundedUser(1000);
		const b = await fundedUser(1000);
		const ev = makeEvent();
		const marketId = await openMarketFromEvent(ev, admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 100 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 100 });

		const final: FeedEvent = { ...ev, status: 'final', homeScore: 1, awayScore: 0, winner: 'home' };
		const summary = await settleDueMarkets({ feed: stubFeed([final]), now: FUTURE() });

		expect(summary).toMatchObject({ resolved: 1, voided: 0, errors: 0 });
		expect(await userBalance(a.id)).toBe(1100); // sole winner takes the 100 pool
		expect(await userBalance(b.id)).toBe(900);

		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m).toMatchObject({
			status: 'resolved',
			winningSide: 'home',
			homeScore: 1,
			awayScore: 0
		});

		// both backers got a settlement notification
		const aNotes = await db.select().from(notifications).where(eq(notifications.userId, a.id));
		expect(aNotes.length).toBeGreaterThanOrEqual(1);
		expect(aNotes.some((n) => n.level === 'success')).toBe(true);

		// running again settles nothing (already resolved → not a candidate)
		const again = await settleDueMarkets({ feed: stubFeed([final]), now: FUTURE() });
		expect(again.resolved).toBe(0);
		expect(await userBalance(a.id)).toBe(1100);
	});

	it('voids a postponed game and refunds (no balance change)', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const ev = makeEvent();
		const marketId = await openMarketFromEvent(ev, admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 60 });

		const summary = await settleDueMarkets({
			feed: stubFeed([{ ...ev, status: 'postponed' }]),
			now: FUTURE()
		});

		expect(summary).toMatchObject({ voided: 1, resolved: 0 });
		expect(await userBalance(a.id)).toBe(100);
		expect(await userBalance(b.id)).toBe(100);
		const [m] = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(m.status).toBe('void');
	});

	it('skips games that are not final and games missing from the feed', async () => {
		const admin = await createUser();
		const a = await fundedUser(1000);
		const b = await fundedUser(1000);
		const ev1 = makeEvent(); // will be reported still in progress
		const ev2 = makeEvent(); // will be absent from the feed
		const m1 = await openMarketFromEvent(ev1, admin.id);
		const m2 = await openMarketFromEvent(ev2, admin.id);
		// give both markets two-sided action so they aren't scrapped as empty
		await placeWager({ marketId: m1, userId: a.id, side: 'home', stake: 10 });
		await placeWager({ marketId: m1, userId: b.id, side: 'away', stake: 10 });
		await placeWager({ marketId: m2, userId: a.id, side: 'home', stake: 10 });
		await placeWager({ marketId: m2, userId: b.id, side: 'away', stake: 10 });

		const summary = await settleDueMarkets({
			feed: stubFeed([{ ...ev1, status: 'in_progress' }]),
			now: FUTURE()
		});
		expect(summary).toMatchObject({ resolved: 0, voided: 0, scrapped: 0, skipped: 2, errors: 0 });
	});

	it('scraps a started market that has no bettors', async () => {
		const admin = await createUser();
		const ev = makeEvent();
		const marketId = await openMarketFromEvent(ev, admin.id); // no wagers placed
		const summary = await settleDueMarkets({ feed: stubFeed([ev]), now: FUTURE() });
		expect(summary).toMatchObject({ scrapped: 1, resolved: 0, voided: 0 });
		const rows = await db.select().from(sportMarkets).where(eq(sportMarkets.id, marketId));
		expect(rows).toHaveLength(0); // deleted
	});

	it('does not settle markets whose game has not started yet', async () => {
		const admin = await createUser();
		const ev = makeEvent(); // startTime tomorrow
		await openMarketFromEvent(ev, admin.id);
		// "now" is the real present, before kickoff → not a candidate
		const summary = await settleDueMarkets({
			feed: stubFeed([{ ...ev, status: 'final', winner: 'home', homeScore: 1, awayScore: 0 }])
		});
		expect(summary).toMatchObject({ resolved: 0, skipped: 0 });
	});
});

describe('sports settlement & the activity feed', () => {
	it('tags settlement ledger entries with the market id', async () => {
		const admin = await createUser();
		const a = await fundedUser(1000);
		const b = await fundedUser(1000);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 100 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 100 });
		await resolveMarket({ marketId, winningSide: 'home', resolvedBy: admin.id });

		const tagged = await db
			.select()
			.from(ledgerEntries)
			.where(eq(ledgerEntries.sportMarketId, marketId));
		expect(tagged.length).toBe(2); // both legs of the one payout transfer
	});

	it('surfaces a sports_settled feed item — not a fake payment', async () => {
		const admin = await createUser();
		const a = await fundedUser(1000);
		const b = await fundedUser(1000);
		const marketId = await openMarketFromEvent(makeEvent(), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 100 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 100 });
		await resolveMarket({ marketId, winningSide: 'home', resolvedBy: admin.id });

		const items = await getFeed({ audience: 'all' });
		// the payout must NOT show up as a friend-to-friend payment
		expect(items.some((i) => i.type === 'payment')).toBe(false);
		const s = items.find((i) => i.type === 'sports_settled');
		expect(s).toBeTruthy();
		if (s && s.type === 'sports_settled') {
			expect(s.winningSide).toBe('home');
			expect(s.push).toBe(false);
			expect(s.winners.map((w) => w.id)).toContain(a.id);
			expect(s.losers.map((l) => l.id)).toContain(b.id);
		}
	});

	it('marks a drawn game as a push in the feed', async () => {
		const admin = await createUser();
		const a = await fundedUser(100);
		const b = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent({ sport: 'soccer' }), admin.id);
		await placeWager({ marketId, userId: a.id, side: 'home', stake: 40 });
		await placeWager({ marketId, userId: b.id, side: 'away', stake: 60 });
		await resolveMarket({ marketId, winningSide: 'draw', resolvedBy: admin.id });

		const items = await getFeed({ audience: 'all' });
		const s = items.find((i) => i.type === 'sports_settled');
		expect(s).toBeTruthy();
		if (s && s.type === 'sports_settled') {
			expect(s.push).toBe(true);
			expect(s.winners).toHaveLength(0);
			expect(s.losers).toHaveLength(0);
		}
	});
});
