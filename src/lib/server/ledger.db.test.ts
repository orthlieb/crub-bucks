import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	users,
	friendships,
	friendInvites,
	bets,
	betParticipants
} from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth/password';
import {
	grantWelcomeIfNeeded,
	userBalance,
	bankBalance,
	assertZeroSum,
	transferBetweenUsers,
	sendFriendRequest,
	acceptFriendRequest,
	areFriends,
	countAcceptedFriends,
	getIncomingRequests,
	createBet,
	resolveBet,
	rebuy,
	acceptBet,
	declineBet,
	materializeInvitesForUser,
	LedgerError
} from '$lib/server/ledger';
import { hasTestDb, resetDb, createUser } from '../../test/db';

// Only run when a test database is configured (TEST_DATABASE_URL).
const suite = hasTestDb ? describe : describe.skip;

// Bets now start 'pending'; bring one live by accepting on behalf of every
// non-creator participant (the creator is auto-accepted at creation).
async function goLive(betId: string, participantIds: string[], creatorId: string) {
	for (const uid of participantIds) {
		if (uid !== creatorId) await acceptBet({ betId, userId: uid });
	}
}

suite('ledger workflows (DB)', () => {
	beforeEach(async () => {
		await resetDb();
	});

	describe('welcome grant', () => {
		it('grants 100 CB on first call and keeps the system zero-sum', async () => {
			const a = await createUser();
			const granted = await grantWelcomeIfNeeded(a.id);
			expect(granted).toBe(true);
			expect(await userBalance(a.id)).toBe(100);
			expect(await bankBalance()).toBe(-100);
			expect(await assertZeroSum()).toBe(true);
		});

		it('is idempotent — a second call does nothing', async () => {
			const a = await createUser();
			expect(await grantWelcomeIfNeeded(a.id)).toBe(true);
			expect(await grantWelcomeIfNeeded(a.id)).toBe(false);
			expect(await userBalance(a.id)).toBe(100);
			expect(await bankBalance()).toBe(-100);
		});
	});

	describe('payments', () => {
		it('moves CB between two users and stays zero-sum', async () => {
			const a = await createUser();
			const b = await createUser();
			await grantWelcomeIfNeeded(a.id);
			await transferBetweenUsers({ fromUserId: a.id, toUserId: b.id, amount: 30, memo: 'lunch' });
			expect(await userBalance(a.id)).toBe(70);
			expect(await userBalance(b.id)).toBe(30);
			expect(await assertZeroSum()).toBe(true);
		});

		it('rejects non-positive amounts', async () => {
			const a = await createUser();
			const b = await createUser();
			await expect(
				transferBetweenUsers({ fromUserId: a.id, toUserId: b.id, amount: 0 })
			).rejects.toBeInstanceOf(LedgerError);
		});
	});

	describe('friendship handshake', () => {
		it('request → accept makes a mutual friendship', async () => {
			const a = await createUser();
			const b = await createUser();

			const res = await sendFriendRequest(a.id, b.email);
			expect(res.result).toBe('sent');
			expect(await areFriends(a.id, b.id)).toBe(false);

			const incoming = await getIncomingRequests(b.id);
			expect(incoming).toHaveLength(1);

			await acceptFriendRequest(b.id, incoming[0].requestId);
			expect(await areFriends(a.id, b.id)).toBe(true);
			expect(await countAcceptedFriends(a.id)).toBe(1);
			expect(await countAcceptedFriends(b.id)).toBe(1);
		});

		it('auto-accepts when both sides request each other', async () => {
			const a = await createUser();
			const c = await createUser();
			await sendFriendRequest(c.id, a.email); // c → a pending
			const res = await sendFriendRequest(a.id, c.email); // a → c meets pending
			expect(res.result).toBe('accepted');
			expect(await areFriends(a.id, c.id)).toBe(true);
		});

		it('enforces the 99-friend cap', async () => {
			const a = await createUser();
			// Bulk-create 99 accepted friends for A.
			const rows = Array.from({ length: 99 }, (_, i) => ({
				email: `cap${i}@test.local`,
				displayName: `Cap${i}`,
				passwordHash: hashPassword('password1234!'),
				emailVerifiedAt: new Date()
			}));
			const created = await db.insert(users).values(rows).returning({ id: users.id });
			await db.insert(friendships).values(
				created.map((u) => ({
					requesterId: a.id,
					addresseeId: u.id,
					status: 'accepted' as const,
					respondedAt: new Date()
				}))
			);
			expect(await countAcceptedFriends(a.id)).toBe(99);

			const extra = await createUser();
			await expect(sendFriendRequest(a.id, extra.email)).rejects.toThrow(/any more friends/i);
		});
	});

	describe('bets', () => {
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

		it('rejects participants who are not friends', async () => {
			const a = await createUser();
			const b = await createUser();
			await expect(
				createBet({
					mode: 'custom',
					title: 'No friends',
					createdBy: a.id,
					participants: [
						{ userId: a.id, payoutIfWin: 10, lossIfLose: 10 },
						{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 }
					]
				})
			).rejects.toThrow(/your friends/i);
		});

		it('requires the creator to be a participant', async () => {
			const { a, b } = await friends();
			await expect(
				createBet({
					mode: 'custom',
					title: 'Bookie',
					createdBy: a.id,
					participants: [
						{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 },
						{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 }
					]
				})
			).rejects.toThrow();
		});

		it('resolves a balanced bet, moves funds, and stays zero-sum', async () => {
			const { a, b } = await friends();
			const betId = await createBet({
				mode: 'custom',
				title: 'Cornhole',
				createdBy: a.id,
				participants: [
					{ userId: a.id, payoutIfWin: 10, lossIfLose: 10 },
					{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 }
				]
			});
			await goLive(betId, [a.id, b.id], a.id);
			await resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id });
			expect(await userBalance(a.id)).toBe(110);
			expect(await userBalance(b.id)).toBe(90);
			expect(await assertZeroSum()).toBe(true);
		});

		it('refuses an unbalanced resolution', async () => {
			const { a, b } = await friends();
			const betId = await createBet({
				mode: 'custom',
				title: 'Lopsided',
				createdBy: a.id,
				participants: [
					{ userId: a.id, payoutIfWin: 10, lossIfLose: 10 },
					{ userId: b.id, payoutIfWin: 5, lossIfLose: 5 }
				]
			});
			await goLive(betId, [a.id, b.id], a.id);
			await expect(
				resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id })
			).rejects.toThrow(/balance/i);
		});

		it('cannot resolve a bet twice', async () => {
			const { a, b } = await friends();
			const betId = await createBet({
				mode: 'custom',
				title: 'Once',
				createdBy: a.id,
				participants: [
					{ userId: a.id, payoutIfWin: 10, lossIfLose: 10 },
					{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 }
				]
			});
			await goLive(betId, [a.id, b.id], a.id);
			await resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id });
			await expect(
				resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id })
			).rejects.toThrow(/already/i);
		});
	});

	describe('bet acceptance', () => {
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

		it('starts pending; creator auto-accepts, invitee does not', async () => {
			const { a, b } = await friends();
			const betId = await customBet(a, b, 'Pending');
			const [row] = await db.select().from(bets).where(eq(bets.id, betId));
			expect(row.status).toBe('pending');
			const ps = await db
				.select()
				.from(betParticipants)
				.where(eq(betParticipants.betId, betId));
			expect(ps.find((p) => p.userId === a.id)!.acceptedAt).not.toBeNull();
			expect(ps.find((p) => p.userId === b.id)!.acceptedAt).toBeNull();
		});

		it('is not resolvable until everyone accepts, then goes live', async () => {
			const { a, b } = await friends();
			const betId = await customBet(a, b, 'Accept me');
			await expect(
				resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id })
			).rejects.toThrow(/pending/i);

			const res = await acceptBet({ betId, userId: b.id });
			expect(res.wentLive).toBe(true);
			const [live] = await db.select().from(bets).where(eq(bets.id, betId));
			expect(live.status).toBe('open');

			await resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id });
			expect(await userBalance(a.id)).toBe(110);
			expect(await assertZeroSum()).toBe(true);
		});

		it('a decline cancels the whole bet and moves no money', async () => {
			const { a, b } = await friends();
			const betId = await customBet(a, b, 'Decline me');
			await declineBet({ betId, userId: b.id });
			const [row] = await db.select().from(bets).where(eq(bets.id, betId));
			expect(row.status).toBe('cancelled');
			expect(row.cancelledBy).toBe(b.id);
			expect(await userBalance(a.id)).toBe(100);
			expect(await userBalance(b.id)).toBe(100);
		});

		it('cannot accept or decline a bet that is already live', async () => {
			const { a, b } = await friends();
			const betId = await customBet(a, b, 'Already live');
			await acceptBet({ betId, userId: b.id }); // goes live
			await expect(acceptBet({ betId, userId: b.id })).rejects.toThrow(/already/i);
			await expect(declineBet({ betId, userId: b.id })).rejects.toThrow(/already/i);
		});
	});

	describe('pooled bet modes', () => {
		// 3 mutual friends, each granted 100 CB.
		async function trio() {
			const a = await createUser();
			const b = await createUser();
			const c = await createUser();
			const pairs = [
				[a, b],
				[a, c],
				[b, c]
			] as const;
			await db.insert(friendships).values(
				pairs.map(([x, y]) => ({
					requesterId: x.id,
					addresseeId: y.id,
					status: 'accepted' as const,
					respondedAt: new Date()
				}))
			);
			for (const u of [a, b, c]) await grantWelcomeIfNeeded(u.id);
			return { a, b, c };
		}

		it('even_split: winner takes pool, losers split equally', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'even_split',
				title: 'Even',
				createdBy: a.id,
				pool: 30,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);
			await resolveBet({ betId, winnerId: a.id, resolvedBy: a.id });
			expect(await userBalance(a.id)).toBe(130); // +30
			expect(await userBalance(b.id)).toBe(85); // -15
			expect(await userBalance(c.id)).toBe(85); // -15
			expect(await assertZeroSum()).toBe(true);
		});

		it('winner_loser: only the loser pays; the extra nets zero', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'winner_loser',
				title: 'WL',
				createdBy: a.id,
				pool: 20,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);
			await resolveBet({ betId, winnerId: a.id, loserId: b.id, resolvedBy: a.id });
			expect(await userBalance(a.id)).toBe(120); // +20
			expect(await userBalance(b.id)).toBe(80); // -20
			expect(await userBalance(c.id)).toBe(100); // unchanged
			expect(await assertZeroSum()).toBe(true);
		});

		it('tiered: losers pay 1/3 and 2/3 of the pool by rank', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'tiered',
				title: 'Tiered',
				createdBy: a.id,
				pool: 30,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);
			// b = first loser (pays least), c = last loser (pays most)
			await resolveBet({ betId, winnerId: a.id, loserOrder: [b.id, c.id], resolvedBy: a.id });
			expect(await userBalance(a.id)).toBe(130); // +30
			expect(await userBalance(b.id)).toBe(90); // -10 (1/3)
			expect(await userBalance(c.id)).toBe(80); // -20 (2/3)
			expect(await assertZeroSum()).toBe(true);
		});

		it('tie-split: manual deltas settle the bet (note, net zero, total = pot)', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'even_split',
				title: 'Tie',
				createdBy: a.id,
				pool: 30,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);

			// A note is required for a manual split.
			await expect(
				resolveBet({ betId, manual: { [a.id]: 15, [b.id]: 15, [c.id]: -30 }, resolvedBy: a.id })
			).rejects.toThrow(/note/i);

			// The split must balance to zero.
			await expect(
				resolveBet({
					betId,
					manual: { [a.id]: 15, [b.id]: 15, [c.id]: -10 },
					note: 'a & b tied for first',
					resolvedBy: a.id
				})
			).rejects.toThrow(/balance/i);

			// It must also move exactly the pot — net-zero but only 20 of the 30 ₡.
			await expect(
				resolveBet({
					betId,
					manual: { [a.id]: 10, [b.id]: 10, [c.id]: -20 },
					note: 'a & b tied for first',
					resolvedBy: a.id
				})
			).rejects.toThrow(/pot/i);

			// a & b tie for first and split the 30 ₡ pot; c eats the loss.
			await resolveBet({
				betId,
				manual: { [a.id]: 15, [b.id]: 15, [c.id]: -30 },
				note: 'a & b tied for first',
				resolvedBy: a.id
			});
			expect(await userBalance(a.id)).toBe(115); // +15
			expect(await userBalance(b.id)).toBe(115); // +15
			expect(await userBalance(c.id)).toBe(70); // -30
			expect(await assertZeroSum()).toBe(true);
		});
	});

	describe('pot mode (re-buys + winnings)', () => {
		async function trio() {
			const a = await createUser();
			const b = await createUser();
			const c = await createUser();
			const pairs = [
				[a, b],
				[a, c],
				[b, c]
			] as const;
			await db.insert(friendships).values(
				pairs.map(([x, y]) => ({
					requesterId: x.id,
					addresseeId: y.id,
					status: 'accepted' as const,
					respondedAt: new Date()
				}))
			);
			for (const u of [a, b, c]) await grantWelcomeIfNeeded(u.id);
			return { a, b, c };
		}

		it('creates with stake×N pool and seeds each bought-in to stake', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'pot',
				title: 'Poker',
				createdBy: a.id,
				stake: 50,
				participantIds: [a.id, b.id, c.id]
			});
			const [row] = await db.select().from(bets).where(eq(bets.id, betId));
			expect(row.mode).toBe('pot');
			expect(Number(row.pool)).toBe(150);
			expect(Number(row.stake)).toBe(50);
			const ps = await db.select().from(betParticipants).where(eq(betParticipants.betId, betId));
			expect(ps.every((p) => Number(p.boughtIn) === 50)).toBe(true);
		});

		it('re-buy grows the pot and the player’s bought_in (self only)', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'pot',
				title: 'Poker',
				createdBy: a.id,
				stake: 50,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);
			await rebuy({ betId, userId: b.id, amount: 50, requestedBy: b.id });
			const [row] = await db.select().from(bets).where(eq(bets.id, betId));
			expect(Number(row.pool)).toBe(200);
			const [bRow] = await db
				.select()
				.from(betParticipants)
				.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, b.id)));
			expect(Number(bRow.boughtIn)).toBe(100);

			// can't re-buy on behalf of someone else
			await expect(
				rebuy({ betId, userId: c.id, amount: 50, requestedBy: a.id })
			).rejects.toThrow(/yourself/i);
		});

		it('resolves with winnings, supports break-even, stays zero-sum', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'pot',
				title: 'Poker',
				createdBy: a.id,
				stake: 50,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);
			// pool = 150; allocate 100 / 50 / 0 → nets +50 / 0 / -50
			await resolveBet({
				betId,
				resolvedBy: a.id,
				winnings: { [a.id]: 100, [b.id]: 50, [c.id]: 0 }
			});
			expect(await userBalance(a.id)).toBe(150); // +50
			expect(await userBalance(b.id)).toBe(100); // 0
			expect(await userBalance(c.id)).toBe(50); // -50
			expect(await assertZeroSum()).toBe(true);
		});

		it('rejects unbalanced winnings', async () => {
			const { a, b, c } = await trio();
			const betId = await createBet({
				mode: 'pot',
				title: 'Poker',
				createdBy: a.id,
				stake: 50,
				participantIds: [a.id, b.id, c.id]
			});
			await goLive(betId, [a.id, b.id, c.id], a.id);
			await expect(
				resolveBet({
					betId,
					resolvedBy: a.id,
					winnings: { [a.id]: 100, [b.id]: 100, [c.id]: 0 } // 200 ≠ 150
				})
			).rejects.toThrow(/total the pot/i);
		});
	});

	describe('email invites', () => {
		it('invites a non-user, then materializes a pending request on signup', async () => {
			const a = await createUser();
			const res = await sendFriendRequest(a.id, 'newbie@test.local');
			expect(res.result).toBe('invited');

			const [invite] = await db
				.select()
				.from(friendInvites)
				.where(eq(friendInvites.email, 'newbie@test.local'));
			expect(invite).toBeTruthy();
			expect(invite.claimedAt).toBeNull();

			const newbie = await createUser({ email: 'newbie@test.local' });
			await materializeInvitesForUser('newbie@test.local', newbie.id);

			const [pending] = await db
				.select()
				.from(friendships)
				.where(and(eq(friendships.requesterId, a.id), eq(friendships.addresseeId, newbie.id)));
			expect(pending.status).toBe('pending');

			const [claimed] = await db
				.select()
				.from(friendInvites)
				.where(eq(friendInvites.email, 'newbie@test.local'));
			expect(claimed.claimedAt).not.toBeNull();
		});
	});
});
