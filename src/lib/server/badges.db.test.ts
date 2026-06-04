import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { friendships, userBadges, notifications, bets } from '$lib/server/db/schema';
import { createBet, resolveBet, acceptBet, grantWelcomeIfNeeded } from '$lib/server/ledger';
import { evaluateBadges, computeMetrics } from '$lib/server/badges';
import { hasTestDb, resetDb, createUser } from '../../test/db';

const suite = hasTestDb ? describe : describe.skip;

async function makeFriends() {
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

// Create a 2-player custom bet, bring it live, and resolve it with a winner.
async function playResolvedBet(aId: string, bId: string, winnerId: string, stake = 20) {
	const betId = await createBet({
		mode: 'custom',
		title: 'Match',
		createdBy: aId,
		participants: [
			{ userId: aId, payoutIfWin: stake, lossIfLose: stake },
			{ userId: bId, payoutIfWin: stake, lossIfLose: stake }
		]
	});
	await acceptBet({ betId, userId: bId }); // creator auto-accepts; this goes live
	const loserId = winnerId === aId ? bId : aId;
	await resolveBet({
		betId,
		outcomes: { [winnerId]: 'won', [loserId]: 'lost' },
		resolvedBy: aId
	});
	return betId;
}

// Create a pooled (even_split) bet so it carries a `pool` (for max_pot).
async function playPooledBet(aId: string, bId: string, winnerId: string, pool: number) {
	const betId = await createBet({
		mode: 'even_split',
		title: 'Pool',
		createdBy: aId,
		pool,
		participantIds: [aId, bId]
	});
	await acceptBet({ betId, userId: bId });
	await resolveBet({ betId, winnerId, resolvedBy: aId });
	return betId;
}

suite('badges (DB)', () => {
	beforeEach(async () => {
		await resetDb();
	});

	it('awards bronze badges from resolved-bet history', async () => {
		const { a, b } = await makeFriends();
		for (let i = 0; i < 5; i++) await playResolvedBet(a.id, b.id, a.id, 20);

		const aBadges = new Map(
			(await db.select().from(userBadges).where(eq(userBadges.userId, a.id))).map((x) => [
				x.badgeKey,
				x.tier
			])
		);
		expect(aBadges.get('first_steps')).toBe('bronze'); // 5 bets joined
		expect(aBadges.get('winner')).toBe('bronze'); // 5 wins
		expect(aBadges.get('all_in')).toBe('bronze'); // 5 × 20 = 100 ₡

		const bBadges = new Map(
			(await db.select().from(userBadges).where(eq(userBadges.userId, b.id))).map((x) => [
				x.badgeKey,
				x.tier
			])
		);
		expect(bBadges.get('first_steps')).toBe('bronze');
		expect(bBadges.has('winner')).toBe(false); // 0 wins
		expect(bBadges.get('all_in')).toBe('bronze'); // lost 100 ₡
	});

	it('is idempotent — re-evaluating awards nothing new', async () => {
		const { a, b } = await makeFriends();
		for (let i = 0; i < 5; i++) await playResolvedBet(a.id, b.id, a.id);
		const again = await evaluateBadges(a.id);
		expect(again).toEqual([]);
	});

	it('upgrades forward only — never downgrades a held tier', async () => {
		const { a, b } = await makeFriends();
		// Seed a gold Winner, then play only enough wins for bronze.
		await db
			.insert(userBadges)
			.values({ userId: a.id, badgeKey: 'winner', tier: 'gold', metricValue: 50 });
		for (let i = 0; i < 5; i++) await playResolvedBet(a.id, b.id, a.id);

		const [w] = await db
			.select()
			.from(userBadges)
			.where(and(eq(userBadges.userId, a.id), eq(userBadges.badgeKey, 'winner')));
		expect(w.tier).toBe('gold');
	});

	it('notifies the earner and their friends', async () => {
		const { a, b } = await makeFriends();
		for (let i = 0; i < 5; i++) await playResolvedBet(a.id, b.id, a.id);

		// The friend (b) received at least one "earned" notification about a.
		const bNotifs = await db.select().from(notifications).where(eq(notifications.userId, b.id));
		expect(bNotifs.some((n) => /earned/i.test(n.title))).toBe(true);

		// The earner (a) got a celebratory one too.
		const aNotifs = await db.select().from(notifications).where(eq(notifications.userId, a.id));
		expect(aNotifs.some((n) => /You earned/i.test(n.title))).toBe(true);
	});

	it('win_streak = longest run of consecutive wins by resolution time', async () => {
		const { a, b } = await makeFriends();
		// Outcomes for `a` in resolution order: W W L W W W → longest streak = 3.
		const aWins = [true, true, false, true, true, true];
		const betIds: string[] = [];
		for (const win of aWins) betIds.push(await playResolvedBet(a.id, b.id, win ? a.id : b.id));

		// Pin resolved_at to a deterministic increasing order (avoid same-ms ties).
		for (let i = 0; i < betIds.length; i++) {
			await db
				.update(bets)
				.set({ resolvedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) })
				.where(eq(bets.id, betIds[i]));
		}

		expect((await computeMetrics(a.id)).win_streak).toBe(3);
		// b lost the ones a won and vice-versa: a's losses are b's wins → b: L L W L L L
		expect((await computeMetrics(b.id)).win_streak).toBe(1);
	});

	it('max_pot = the largest single pool the user was in', async () => {
		const { a, b } = await makeFriends();
		await grantWelcomeIfNeeded(a.id);
		await playPooledBet(a.id, b.id, a.id, 80);
		await playPooledBet(a.id, b.id, a.id, 300);
		await playPooledBet(a.id, b.id, a.id, 120);

		expect((await computeMetrics(a.id)).max_pot).toBe(300);

		// 300 ≥ 250 → Big Bowl silver for both participants.
		await evaluateBadges(a.id);
		const [bb] = await db
			.select()
			.from(userBadges)
			.where(and(eq(userBadges.userId, a.id), eq(userBadges.badgeKey, 'big_bowl')));
		expect(bb.tier).toBe('silver');
	});
});
