import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications, users } from '$lib/server/db/schema';
import { createNotification, dismissForUser } from '$lib/server/notifications';
import {
	sendFriendRequest,
	transferBetweenUsers,
	grantWelcomeIfNeeded
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
});
