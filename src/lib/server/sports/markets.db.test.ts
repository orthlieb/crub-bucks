import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { sportMarkets, sportWagers } from '../db/schema';
import { resetDb, createUser } from '../../../test/db';
import { issueFromBank, userBalance } from '../ledger';
import {
	openMarketFromEvent,
	placeWager,
	resolveMarket,
	voidMarket,
	poolsBySide,
	MarketError
} from './markets';
import type { FeedEvent } from './types';

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

	it('rejects a draw pick on a sport without draws', async () => {
		const admin = await createUser();
		const u = await fundedUser(100);
		const marketId = await openMarketFromEvent(makeEvent({ sport: 'baseball' }), admin.id);
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
