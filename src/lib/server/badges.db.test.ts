import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { friendships, userBadges, notifications } from '$lib/server/db/schema';
import { createBet, resolveBet, acceptBet, grantWelcomeIfNeeded } from '$lib/server/ledger';
import { evaluateBadges } from '$lib/server/badges';
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
});
