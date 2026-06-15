import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications, users, friendships } from '$lib/server/db/schema';
import {
	createNotification,
	dismissForUser,
	dismissAllForUser,
	listActiveForUser
} from '$lib/server/notifications';
import {
	sendFriendRequest,
	transferBetweenUsers,
	grantWelcomeIfNeeded,
	createBet,
	acceptBet,
	resolveBet
} from '$lib/server/ledger';
import { hasTestDb, resetDb, createUser } from '../../test/db';

const suite = hasTestDb ? describe : describe.skip;

async function notifExists(id: string): Promise<boolean> {
	const [row] = await db
		.select({ id: notifications.id })
		.from(notifications)
		.where(eq(notifications.id, id));
	return !!row;
}

suite('notification GC on dismissal', () => {
	beforeEach(async () => {
		await resetDb();
	});

	it('deletes a targeted notification when its recipient dismisses it', async () => {
		const a = await createUser();
		const id = await createNotification({ title: 'Hi', userId: a.id });
		expect(await notifExists(id)).toBe(true);
		await dismissForUser(id, a.id);
		expect(await notifExists(id)).toBe(false);
	});

	it('clear-all dismisses everything for the user; broadcasts survive for others', async () => {
		const a = await createUser();
		const b = await createUser();
		const t1 = await createNotification({ title: 'For A #1', userId: a.id }); // targeted
		const bc = await createNotification({ title: 'Everyone' }); // broadcast
		const t2 = await createNotification({ title: 'For A #2', userId: a.id }); // targeted

		expect(await listActiveForUser(a.id)).toHaveLength(3); // 2 targeted + broadcast
		expect(await listActiveForUser(b.id)).toHaveLength(1); // just the broadcast

		const cleared = await dismissAllForUser(a.id);
		expect(cleared).toBe(3);

		// A now sees nothing; their targeted notifications are GC'd outright.
		expect(await listActiveForUser(a.id)).toHaveLength(0);
		expect(await notifExists(t1)).toBe(false);
		expect(await notifExists(t2)).toBe(false);

		// The broadcast persists because B hasn't cleared it yet.
		expect(await notifExists(bc)).toBe(true);
		expect(await listActiveForUser(b.id)).toHaveLength(1);

		// Once B clears it too, it's garbage-collected.
		await dismissForUser(bc, b.id);
		expect(await notifExists(bc)).toBe(false);
	});

	it('keeps a broadcast until every active user has dismissed it', async () => {
		const a = await createUser();
		const b = await createUser();
		const id = await createNotification({ title: 'Everyone' }); // broadcast (userId null)
		await dismissForUser(id, a.id);
		expect(await notifExists(id)).toBe(true); // b still hasn't
		await dismissForUser(id, b.id);
		expect(await notifExists(id)).toBe(false); // now all active users have
	});

	it('does not let a suspended user block broadcast cleanup', async () => {
		const a = await createUser();
		const b = await createUser();
		await db.update(users).set({ isActive: false }).where(eq(users.id, b.id));
		const id = await createNotification({ title: 'Everyone' });
		await dismissForUser(id, a.id); // only the active user dismisses
		expect(await notifExists(id)).toBe(false);
	});

	it('a friend request notifies the addressee with a /app/friends link', async () => {
		const a = await createUser({ displayName: 'Aaron' });
		const b = await createUser();
		await sendFriendRequest(a.id, b.email);
		const [n] = await db.select().from(notifications).where(eq(notifications.userId, b.id));
		expect(n?.link).toBe('/app/friends');
		expect(n?.title).toMatch(/Aaron/);
	});

	it('a peer payment notifies the recipient with a /app/feed link', async () => {
		const a = await createUser({ displayName: 'Payer' });
		const b = await createUser();
		await grantWelcomeIfNeeded(a.id);
		await transferBetweenUsers({ fromUserId: a.id, toUserId: b.id, amount: 10, memo: 'lunch' });
		const [n] = await db.select().from(notifications).where(eq(notifications.userId, b.id));
		expect(n?.link).toBe('/app/feed');
		expect(n?.title).toMatch(/Payer.*10/);
	});

	it('resolving a bet notifies the other participants with a /app/bet link', async () => {
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
		const betId = await createBet({
			mode: 'custom',
			title: 'Darts',
			createdBy: a.id,
			participants: [
				{ userId: a.id, payoutIfWin: 10, lossIfLose: 10 },
				{ userId: b.id, payoutIfWin: 10, lossIfLose: 10 }
			]
		});
		await acceptBet({ betId, userId: b.id });
		await resolveBet({ betId, outcomes: { [a.id]: 'won', [b.id]: 'lost' }, resolvedBy: a.id });

		const bNotifs = await db.select().from(notifications).where(eq(notifications.userId, b.id));
		const settled = bNotifs.find((n) => n.title.includes('settled'));
		expect(settled?.link).toBe(`/app/bet/${betId}`);

		// The resolver (a) doesn't get a "settled" notification.
		const aNotifs = await db.select().from(notifications).where(eq(notifications.userId, a.id));
		expect(aNotifs.some((n) => n.title.includes('settled'))).toBe(false);
	});
});
