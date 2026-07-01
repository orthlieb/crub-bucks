import { describe, it, expect, beforeEach } from 'vitest';
import { db } from './db';
import { notifications, leaderboardMedals } from './db/schema';
import { resetDb, createUser } from '../../test/db';
import { issueFromBank, getLeaderboard, refreshLeaderboardMedals } from './ledger';

beforeEach(resetDb);

/** A user funded with `amount` CB from the Bank (which also creates their wallet). */
async function fund(amount: number, displayName?: string) {
	const u = await createUser(displayName ? { displayName } : undefined);
	if (amount) await issueFromBank({ toUserId: u.id, amount, memo: 'seed' });
	return u;
}

const leaderboardNotifs = async () =>
	(await db.select().from(notifications)).filter((n) =>
		n.title.toLowerCase().includes('leaderboard')
	);

describe('getLeaderboard', () => {
	it('ranks active users by balance (desc), ties broken by name', async () => {
		await fund(300, 'Alice');
		await fund(200, 'Cara');
		await fund(100, 'Bob');
		const lb = await getLeaderboard(10);
		expect(lb.map((e) => e.displayName)).toEqual(['Alice', 'Cara', 'Bob']);
		expect(lb[0].balance).toBe(300);
	});

	it('respects the limit', async () => {
		for (let i = 0; i < 5; i++) await fund(i * 10 + 1);
		expect(await getLeaderboard(3)).toHaveLength(3);
	});
});

describe('refreshLeaderboardMedals', () => {
	it('notifies the top three, stores state, and does not re-notify when unchanged', async () => {
		const a = await fund(300, 'Alice');
		await fund(200, 'Bob');
		await fund(100, 'Cara');

		await refreshLeaderboardMedals();
		expect(await leaderboardNotifs()).toHaveLength(3); // gold/silver/bronze

		const medals = await db.select().from(leaderboardMedals);
		expect(medals.find((m) => m.rank === 1)?.userId).toBe(a.id);

		// No change → no new notifications.
		await refreshLeaderboardMedals();
		expect(await leaderboardNotifs()).toHaveLength(3);
	});

	it('notifies the new holder and whoever is bumped off the podium', async () => {
		await fund(300, 'Alice');
		await fund(200, 'Bob');
		const cara = await fund(100, 'Cara');
		await refreshLeaderboardMedals();

		// Dave shoots to #1, pushing everyone down — Cara falls off the podium.
		const dave = await fund(500, 'Dave');
		await refreshLeaderboardMedals();

		const notifs = await db.select().from(notifications);
		expect(notifs.some((n) => n.userId === dave.id && n.title.toLowerCase().includes('gold'))).toBe(
			true
		);
		expect(notifs.some((n) => n.userId === cara.id && n.title.toLowerCase().includes('lost'))).toBe(
			true
		);
	});
});
