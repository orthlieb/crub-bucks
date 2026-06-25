import { describe, it, expect } from 'vitest';
import {
	planSettlement,
	allocate,
	evenSplitDeltas,
	winnerLoserDeltas,
	tieredDeltas,
	potSplitDeltas,
	oddsDeltas,
	parimutuelDeltas,
	BetMathError,
	type ParticipantDelta,
	type SettlementTransfer
} from './ledger-math';

const sum = (ds: ParticipantDelta[]) => ds.reduce((s, d) => s + d.delta, 0);
const find = (ds: ParticipantDelta[], id: string) => ds.find((d) => d.userId === id)!.delta;

/** Sum the transfers each user receives (positive) / pays (negative). */
function net(transfers: SettlementTransfer[]): Map<string, number> {
	const m = new Map<string, number>();
	for (const t of transfers) {
		m.set(t.toUserId, (m.get(t.toUserId) ?? 0) + t.amount);
		m.set(t.fromUserId, (m.get(t.fromUserId) ?? 0) - t.amount);
	}
	return m;
}

describe('planSettlement', () => {
	it('settles a simple 1v1 bet with one transfer', () => {
		const t = planSettlement([{ userId: 'w', amount: 10 }], [{ userId: 'l', amount: 10 }]);
		expect(t).toEqual([{ fromUserId: 'l', toUserId: 'w', amount: 10 }]);
	});

	it('fans one loser out to multiple winners (team win)', () => {
		const t = planSettlement(
			[
				{ userId: 'w1', amount: 15 },
				{ userId: 'w2', amount: 15 }
			],
			[{ userId: 'l', amount: 30 }]
		);
		const n = net(t);
		expect(n.get('w1')).toBe(15);
		expect(n.get('w2')).toBe(15);
		expect(n.get('l')).toBe(-30);
	});

	it('collects from multiple losers to multiple winners with uneven stakes', () => {
		const winners = [
			{ userId: 'w1', amount: 20 },
			{ userId: 'w2', amount: 10 }
		];
		const losers = [
			{ userId: 'l1', amount: 25 },
			{ userId: 'l2', amount: 5 }
		];
		const t = planSettlement(winners, losers);
		const n = net(t);
		// Every party nets exactly their declared amount.
		expect(n.get('w1')).toBe(20);
		expect(n.get('w2')).toBe(10);
		expect(n.get('l1')).toBe(-25);
		expect(n.get('l2')).toBe(-5);
		// And the whole thing nets to zero.
		expect([...n.values()].reduce((s, v) => s + v, 0)).toBe(0);
	});

	it('produces transfers that sum to the pot', () => {
		const t = planSettlement(
			[
				{ userId: 'a', amount: 7 },
				{ userId: 'b', amount: 3 }
			],
			[
				{ userId: 'c', amount: 4 },
				{ userId: 'd', amount: 6 }
			]
		);
		expect(t.reduce((s, x) => s + x.amount, 0)).toBe(10);
	});

	it('does not mutate its inputs', () => {
		const winners = [{ userId: 'w', amount: 10 }];
		const losers = [{ userId: 'l', amount: 10 }];
		planSettlement(winners, losers);
		expect(winners[0].amount).toBe(10);
		expect(losers[0].amount).toBe(10);
	});

	it('returns nothing when there are no winners or no losers', () => {
		expect(planSettlement([], [{ userId: 'l', amount: 5 }])).toEqual([]);
		expect(planSettlement([{ userId: 'w', amount: 5 }], [])).toEqual([]);
	});
});

describe('allocate', () => {
	it('splits evenly when divisible', () => {
		expect(allocate(30, [1, 1, 1])).toEqual([10, 10, 10]);
	});

	it('distributes the remainder and still sums to total', () => {
		const parts = allocate(10, [1, 1, 1]); // 10/3
		expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
		expect(parts.every((p) => Number.isInteger(p))).toBe(true);
	});

	it('weights proportionally (tiered shape)', () => {
		expect(allocate(6, [1, 2, 3])).toEqual([1, 2, 3]);
		expect(allocate(3, [1, 2])).toEqual([1, 2]);
	});
});

describe('evenSplitDeltas', () => {
	it('winner takes pool, losers split equally, nets to zero', () => {
		const d = evenSplitDeltas(30, 'w', ['a', 'b', 'c']);
		expect(find(d, 'w')).toBe(30);
		expect(find(d, 'a')).toBe(-10);
		expect(find(d, 'b')).toBe(-10);
		expect(find(d, 'c')).toBe(-10);
		expect(sum(d)).toBe(0);
	});

	it('stays exact with an indivisible pool', () => {
		const d = evenSplitDeltas(10, 'w', ['a', 'b', 'c']);
		expect(find(d, 'w')).toBe(10);
		expect(sum(d)).toBe(0);
		const losses = ['a', 'b', 'c'].map((id) => -find(d, id));
		expect(losses.reduce((a, b) => a + b, 0)).toBe(10);
	});
});

describe('winnerLoserDeltas', () => {
	it('only the named loser pays; extras net zero', () => {
		const d = winnerLoserDeltas(25, 'w', 'l', ['x', 'y']);
		expect(find(d, 'w')).toBe(25);
		expect(find(d, 'l')).toBe(-25);
		expect(find(d, 'x')).toBe(0);
		expect(find(d, 'y')).toBe(0);
		expect(sum(d)).toBe(0);
	});
});

describe('tieredDeltas', () => {
	it('3 players: losers pay 1/3 and 2/3 of the pool', () => {
		const d = tieredDeltas(30, 'w', ['first', 'second']);
		expect(find(d, 'w')).toBe(30);
		expect(find(d, 'first')).toBe(-10); // 1/3 of 30
		expect(find(d, 'second')).toBe(-20); // 2/3 of 30
		expect(sum(d)).toBe(0);
	});

	it('4 players: losers pay 1/6, 2/6, 3/6 of the pool', () => {
		const d = tieredDeltas(60, 'w', ['l1', 'l2', 'l3']);
		expect(find(d, 'l1')).toBe(-10); // 1/6 of 60
		expect(find(d, 'l2')).toBe(-20); // 2/6
		expect(find(d, 'l3')).toBe(-30); // 3/6
		expect(sum(d)).toBe(0);
	});

	it('last-ordered loser always pays the most and it nets to zero', () => {
		const d = tieredDeltas(17, 'w', ['l1', 'l2', 'l3']); // indivisible
		expect(sum(d)).toBe(0);
		expect(-find(d, 'l3')).toBeGreaterThanOrEqual(-find(d, 'l2'));
		expect(-find(d, 'l2')).toBeGreaterThanOrEqual(-find(d, 'l1'));
	});

	it('losses are whole CB and sum to exactly the pot for many indivisible pools', () => {
		for (const pool of [1, 2, 5, 7, 13, 17, 31, 100, 101, 999]) {
			for (const losers of [1, 2, 3, 4, 5]) {
				const ids = Array.from({ length: losers }, (_, i) => `l${i}`);
				const d = tieredDeltas(pool, 'w', ids);
				// winner takes exactly the pot
				expect(find(d, 'w')).toBe(pool);
				// every delta is a whole number
				expect(d.every((x) => Number.isInteger(x.delta))).toBe(true);
				// losers' losses sum to exactly the pot (and the whole thing nets to 0)
				const totalLoss = ids.reduce((s, id) => s + -find(d, id), 0);
				expect(totalLoss).toBe(pool);
				expect(sum(d)).toBe(0);
				// rank order preserved (non-decreasing by rank)
				for (let i = 1; i < ids.length; i++) {
					expect(-find(d, ids[i])).toBeGreaterThanOrEqual(-find(d, ids[i - 1]));
				}
			}
		}
	});
});

describe('potSplitDeltas', () => {
	it('settles a poker night: three buy in 100, winnings 200 / 100 / 0', () => {
		const d = potSplitDeltas([
			{ userId: 'a', boughtIn: 100, winnings: 200 },
			{ userId: 'b', boughtIn: 100, winnings: 100 },
			{ userId: 'c', boughtIn: 100, winnings: 0 }
		]);
		expect(find(d, 'a')).toBe(100);
		expect(find(d, 'b')).toBe(0); // break-even
		expect(find(d, 'c')).toBe(-100);
		expect(sum(d)).toBe(0);
	});

	it('honours re-buys: someone bought in more than the base stake', () => {
		const d = potSplitDeltas([
			{ userId: 'a', boughtIn: 100, winnings: 350 },
			{ userId: 'b', boughtIn: 100, winnings: 0 },
			{ userId: 'c', boughtIn: 150, winnings: 0 } // re-bought 50
		]);
		expect(find(d, 'a')).toBe(250);
		expect(find(d, 'b')).toBe(-100);
		expect(find(d, 'c')).toBe(-150);
		expect(sum(d)).toBe(0);
	});

	it('supports break-even all round (winnings == bought-in for each)', () => {
		const d = potSplitDeltas([
			{ userId: 'a', boughtIn: 50, winnings: 50 },
			{ userId: 'b', boughtIn: 50, winnings: 50 }
		]);
		expect(d.every((x) => x.delta === 0)).toBe(true);
		expect(sum(d)).toBe(0);
	});

	it('throws when winnings do not total the pot', () => {
		expect(() =>
			potSplitDeltas([
				{ userId: 'a', boughtIn: 100, winnings: 100 },
				{ userId: 'b', boughtIn: 100, winnings: 50 }
			])
		).toThrow(BetMathError);
	});

	it('rejects fractional or negative inputs', () => {
		expect(() => potSplitDeltas([{ userId: 'a', boughtIn: 10.5, winnings: 10 }])).toThrow(
			BetMathError
		);
		expect(() => potSplitDeltas([{ userId: 'a', boughtIn: 10, winnings: -1 }])).toThrow(
			BetMathError
		);
	});
});

describe('oddsDeltas', () => {
	it('head-to-head: stakes encode the odds (100 vs 10)', () => {
		const stakes = [
			{ userId: 'a', stake: 100 },
			{ userId: 'b', stake: 10 }
		];
		// a wins → takes b's 10; b only risked 10 to win 100.
		const aWins = oddsDeltas(stakes, 'a');
		expect(find(aWins, 'a')).toBe(10);
		expect(find(aWins, 'b')).toBe(-10);
		expect(sum(aWins)).toBe(0);
		// b wins → takes a's 100.
		const bWins = oddsDeltas(stakes, 'b');
		expect(find(bWins, 'b')).toBe(100);
		expect(find(bWins, 'a')).toBe(-100);
		expect(sum(bWins)).toBe(0);
	});

	it('three players, winner takes the sum of the other stakes', () => {
		const stakes = [
			{ userId: 'a', stake: 50 },
			{ userId: 'b', stake: 20 },
			{ userId: 'c', stake: 10 }
		];
		const d = oddsDeltas(stakes, 'c'); // longshot hits
		expect(find(d, 'c')).toBe(70); // 50 + 20
		expect(find(d, 'a')).toBe(-50);
		expect(find(d, 'b')).toBe(-20);
		expect(sum(d)).toBe(0);
	});

	it('rejects a non-positive or fractional wager', () => {
		expect(() =>
			oddsDeltas(
				[
					{ userId: 'a', stake: 0 },
					{ userId: 'b', stake: 5 }
				],
				'b'
			)
		).toThrow(BetMathError);
		expect(() =>
			oddsDeltas(
				[
					{ userId: 'a', stake: 5.5 },
					{ userId: 'b', stake: 5 }
				],
				'a'
			)
		).toThrow(BetMathError);
	});

	it('rejects a winner who is not a participant', () => {
		expect(() =>
			oddsDeltas(
				[
					{ userId: 'a', stake: 5 },
					{ userId: 'b', stake: 5 }
				],
				'z'
			)
		).toThrow(BetMathError);
	});
});

describe('parimutuelDeltas', () => {
	it('splits the losing pool across winners proportional to stake', () => {
		const d = parimutuelDeltas(
			[
				{ userId: 'a', side: 'home', stake: 100 },
				{ userId: 'b', side: 'home', stake: 50 },
				{ userId: 'c', side: 'away', stake: 30 },
				{ userId: 'd', side: 'away', stake: 20 }
			],
			'home'
		);
		// losers' pool = 50, split 100:50 → 33 / 17 after largest-remainder
		expect(find(d, 'a')).toBe(33);
		expect(find(d, 'b')).toBe(17);
		expect(find(d, 'c')).toBe(-30);
		expect(find(d, 'd')).toBe(-20);
		expect(sum(d)).toBe(0);
		// winners' profits exactly equal the losers' pool
		expect(find(d, 'a') + find(d, 'b')).toBe(30 + 20);
	});

	it('reduces to odds mode when there is a single winner', () => {
		const wagers = [
			{ userId: 'a', side: 'home', stake: 50 },
			{ userId: 'b', side: 'away', stake: 20 },
			{ userId: 'c', side: 'draw', stake: 10 }
		];
		const pari = parimutuelDeltas(wagers, 'home');
		const odds = oddsDeltas(
			wagers.map((w) => ({ userId: w.userId, stake: w.stake })),
			'a'
		);
		// same money outcome: lone winner takes the whole losing pool
		expect(find(pari, 'a')).toBe(find(odds, 'a'));
		expect(find(pari, 'b')).toBe(find(odds, 'b'));
		expect(find(pari, 'c')).toBe(find(odds, 'c'));
		expect(find(pari, 'a')).toBe(30);
		expect(sum(pari)).toBe(0);
	});

	it('refunds (all zero) when nobody backed the winning side', () => {
		const d = parimutuelDeltas(
			[
				{ userId: 'a', side: 'home', stake: 40 },
				{ userId: 'b', side: 'away', stake: 60 }
			],
			'draw'
		);
		expect(d.every((x) => x.delta === 0)).toBe(true);
		expect(sum(d)).toBe(0);
	});

	it('nets zero when everyone backed the winning side (nothing to win)', () => {
		const d = parimutuelDeltas(
			[
				{ userId: 'a', side: 'home', stake: 40 },
				{ userId: 'b', side: 'home', stake: 60 }
			],
			'home'
		);
		expect(d.every((x) => x.delta === 0)).toBe(true);
		expect(sum(d)).toBe(0);
	});

	it('is whole-CB and zero-sum across many indivisible pools and splits', () => {
		const stakeSets = [
			[7, 5, 3],
			[100, 1, 1],
			[13, 11, 7, 5],
			[1, 1, 1, 1, 1],
			[999, 333, 17]
		];
		for (const stakes of stakeSets) {
			// first two back 'home', the rest back 'away'
			const wagers = stakes.map((s, i) => ({
				userId: `u${i}`,
				side: i < 2 ? 'home' : 'away',
				stake: s
			}));
			const d = parimutuelDeltas(wagers, 'home');
			expect(d.every((x) => Number.isInteger(x.delta))).toBe(true);
			expect(sum(d)).toBe(0);
			// winners' total profit equals the losers' total stake
			const losersPool = stakes.slice(2).reduce((a, b) => a + b, 0);
			const winnersProfit = ['u0', 'u1'].reduce((a, id) => a + find(d, id), 0);
			expect(winnersProfit).toBe(losersPool);
			// no winner ever nets negative; no loser ever nets positive
			expect(find(d, 'u0')).toBeGreaterThanOrEqual(0);
			expect(find(d, 'u1')).toBeGreaterThanOrEqual(0);
		}
	});

	it('rejects a non-positive or fractional wager', () => {
		expect(() =>
			parimutuelDeltas(
				[
					{ userId: 'a', side: 'home', stake: 0 },
					{ userId: 'b', side: 'away', stake: 5 }
				],
				'home'
			)
		).toThrow(BetMathError);
		expect(() =>
			parimutuelDeltas(
				[
					{ userId: 'a', side: 'home', stake: 5.5 },
					{ userId: 'b', side: 'away', stake: 5 }
				],
				'home'
			)
		).toThrow(BetMathError);
	});
});
