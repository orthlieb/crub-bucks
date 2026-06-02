import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { notifications, users } from '$lib/server/db/schema';
import { createNotification, dismissForUser } from '$lib/server/notifications';
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
});
