import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pushSubscriptions } from '$lib/server/db/schema';
import {
	savePushSubscription,
	removePushSubscription,
	isValidSubscription
} from '$lib/server/push';
import { hasTestDb, resetDb, createUser } from '../../test/db';

const suite = hasTestDb ? describe : describe.skip;

function sub(endpoint: string, p256dh = 'pub', auth = 'auth') {
	return { endpoint, keys: { p256dh, auth } };
}

describe('isValidSubscription', () => {
	it('accepts a well-formed subscription', () => {
		expect(isValidSubscription(sub('https://push/1'))).toBe(true);
	});
	it('rejects malformed input', () => {
		expect(isValidSubscription(null)).toBe(false);
		expect(isValidSubscription({})).toBe(false);
		expect(isValidSubscription({ endpoint: 'x' })).toBe(false);
		expect(isValidSubscription({ endpoint: 'x', keys: { p256dh: 'p' } })).toBe(false);
	});
});

suite('push subscriptions (DB)', () => {
	beforeEach(async () => {
		await resetDb();
	});

	it('saves a subscription for a user', async () => {
		const u = await createUser();
		await savePushSubscription(u.id, sub('https://push/ep1'), 'UA/1');
		const rows = await db
			.select()
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].endpoint).toBe('https://push/ep1');
		expect(rows[0].userAgent).toBe('UA/1');
	});

	it('upserts on the same endpoint — re-subscribe updates keys + owner', async () => {
		const a = await createUser();
		const b = await createUser();
		await savePushSubscription(a.id, sub('https://push/shared', 'oldpub', 'oldauth'), null);
		await savePushSubscription(b.id, sub('https://push/shared', 'newpub', 'newauth'), 'UA');

		const all = await db
			.select()
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.endpoint, 'https://push/shared'));
		expect(all).toHaveLength(1); // one row per endpoint
		expect(all[0].userId).toBe(b.id);
		expect(all[0].p256dh).toBe('newpub');
	});

	it('supports multiple devices per user', async () => {
		const u = await createUser();
		await savePushSubscription(u.id, sub('https://push/d1'), null);
		await savePushSubscription(u.id, sub('https://push/d2'), null);
		const rows = await db
			.select()
			.from(pushSubscriptions)
			.where(eq(pushSubscriptions.userId, u.id));
		expect(rows).toHaveLength(2);
	});

	it('removes only the requesting user’s subscription', async () => {
		const a = await createUser();
		const b = await createUser();
		await savePushSubscription(a.id, sub('https://push/aep'), null);

		// b cannot remove a's endpoint (scoped to the owner) → no-op.
		await removePushSubscription(b.id, 'https://push/aep');
		expect(
			await db
				.select()
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.endpoint, 'https://push/aep'))
		).toHaveLength(1);

		// a removes its own → gone.
		await removePushSubscription(a.id, 'https://push/aep');
		expect(
			await db
				.select()
				.from(pushSubscriptions)
				.where(eq(pushSubscriptions.endpoint, 'https://push/aep'))
		).toHaveLength(0);
	});
});
