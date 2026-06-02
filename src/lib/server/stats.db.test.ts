import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '$lib/server/db';
import { friendships } from '$lib/server/db/schema';
import {
	grantWelcomeIfNeeded,
	createBet,
	acceptBet,
	resolveBet,
	cancelBet
} from '$lib/server/ledger';
import { getStats, recomputeStats } from '$lib/server/stats';
import { hasTestDb, resetDb, createUser } from '../../test/db';

const suite = hasTestDb ? describe : describe.skip;

suite('global stats counters', () => {
	beforeEach(async () => {
		await resetDb();
	});

	async function friends() {
		const a = await createUser();
		const b = await createUser();
		await db.insert(friendships).values({
			requesterId: a.id,
			addresseeId: b.id,
			status: 'accepted',
			respondedAt: new Date()
		});
		await grantWelcomeIfNeeded(a.id);
		await grantWelcomeIfNeeded(b.id);
		return { a, b };
	}

	function customBet(a: { id: string }, b: { id: string }, title: string) {
		return createBet({
			mode: 'custom',
			title,
			createdBy: a.id,
			participants: [
				{ userId: a.id, payoutIfWin: 10, lossIfLose: 10 },
				{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 }
			]
		});
	}

	it('welcome grants drive bankTotal negative', async () => {
		await friends(); // two 100 ₡ grants from the Bank
		expect((await getStats()).bankTotal).toBe(-200);
	});

	it('tracks open / resolved / wagered across the bet lifecycle', async () => {
		const { a, b } = await friends();
		const betId = await customBet(a, b, 'Lifecycle');

		// Pending → not counted as open.
		expect((await getStats()).betsOpen).toBe(0);

		await acceptBet({ betId, userId: b.id }); // goes live
		expect((await getStats()).betsOpen).toBe(1);

		await resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id });
		const s = await getStats();
		expect(s.betsOpen).toBe(0);
		expect(s.betsResolved).toBe(1);
		expect(s.bucksWagered).toBe(10); // b paid a 10
	});

	it('cancelling a live bet decrements open (but a pending one does not)', async () => {
		const { a, b } = await friends();

		const pending = await customBet(a, b, 'Pending');
		await cancelBet({ betId: pending, cancelledBy: a.id }); // never went live
		expect((await getStats()).betsOpen).toBe(0);

		const live = await customBet(a, b, 'Live');
		await acceptBet({ betId: live, userId: b.id });
		expect((await getStats()).betsOpen).toBe(1);
		await cancelBet({ betId: live, cancelledBy: a.id });
		expect((await getStats()).betsOpen).toBe(0);
	});

	it('recomputeStats matches the incrementally-maintained counters', async () => {
		const { a, b } = await friends();
		const betId = await customBet(a, b, 'Recompute');
		await acceptBet({ betId, userId: b.id });
		await resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id });

		const incremental = await getStats();
		const recomputed = await recomputeStats();
		expect(recomputed).toEqual(incremental);
	});
});
