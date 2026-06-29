import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { friendships } from './db/schema';
import { resetDb, createUser } from '../../test/db';
import {
	establishFriendship,
	areFriends,
	findUserByQrToken,
	getQrToken,
	resetQrToken,
	sendFriendRequest
} from './ledger';

beforeEach(resetDb);

describe('establishFriendship', () => {
	it('creates a mutual friendship and is idempotent (double-submit safe)', async () => {
		const a = await createUser();
		const b = await createUser();

		expect(await establishFriendship(a.id, b.id)).toBe('created');
		expect(await areFriends(a.id, b.id)).toBe(true);
		expect(await areFriends(b.id, a.id)).toBe(true);

		// Re-runs from either direction are no-ops — no duplicate rows.
		expect(await establishFriendship(a.id, b.id)).toBe('already');
		expect(await establishFriendship(b.id, a.id)).toBe('already');
		const rows = await db
			.select({ id: friendships.id })
			.from(friendships)
			.where(eq(friendships.status, 'accepted'));
		expect(rows).toHaveLength(1);
	});

	it('rejects a self-add', async () => {
		const a = await createUser();
		expect(await establishFriendship(a.id, a.id)).toBe('self');
		expect(await areFriends(a.id, a.id)).toBe(false);
	});

	it('accepts an existing pending request instead of duplicating it', async () => {
		const a = await createUser();
		const b = await createUser();
		// a → b pending request (b hasn't accepted).
		const { result } = await sendFriendRequest(a.id, b.email);
		expect(result).toBe('sent');
		expect(await areFriends(a.id, b.id)).toBe(false);

		// b scans a's QR → the pending request is accepted, not duplicated.
		expect(await establishFriendship(b.id, a.id)).toBe('accepted_request');
		expect(await areFriends(a.id, b.id)).toBe(true);
		const rows = await db.select({ id: friendships.id }).from(friendships);
		expect(rows).toHaveLength(1);
	});
});

describe('QR token queries', () => {
	it('every user gets a unique token, findable by it', async () => {
		const a = await createUser();
		const b = await createUser();
		const ta = await getQrToken(a.id);
		const tb = await getQrToken(b.id);
		expect(ta).toBeTruthy();
		expect(tb).toBeTruthy();
		expect(ta).not.toBe(tb);
		expect((await findUserByQrToken(ta!))?.id).toBe(a.id);
		expect(await findUserByQrToken('nope')).toBeNull();
	});

	it('reset rotates the token and invalidates the old one', async () => {
		const a = await createUser();
		const oldToken = (await getQrToken(a.id))!;
		const newToken = await resetQrToken(a.id);
		expect(newToken).not.toBe(oldToken);
		expect(await findUserByQrToken(oldToken)).toBeNull();
		expect((await findUserByQrToken(newToken))?.id).toBe(a.id);
	});
});
