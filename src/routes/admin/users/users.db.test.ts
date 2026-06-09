import { describe, it, expect, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { RequestEvent } from './$types';
import { db } from '$lib/server/db';
import { users, securityEvents } from '$lib/server/db/schema';
import { actions } from './+page.server';
import { hasTestDb, resetDb, createUser } from '../../../test/db';

const suite = hasTestDb ? describe : describe.skip;

/**
 * Build the minimal RequestEvent the admin actions touch: a POST whose body is
 * form-encoded, plus `locals.user` (the acting admin) and getClientAddress.
 */
function event(actorId: string, fields: Record<string, string>): RequestEvent {
	return {
		request: new Request('http://localhost/admin/users', {
			method: 'POST',
			body: new URLSearchParams(fields)
		}),
		locals: { user: { id: actorId } },
		getClientAddress: () => '127.0.0.1'
	} as unknown as RequestEvent;
}

async function makeAdmin() {
	const a = await createUser({ displayName: 'Adminny' });
	await db.update(users).set({ role: 'admin' }).where(eq(users.id, a.id));
	return a;
}

async function row(id: string) {
	const [u] = await db
		.select({
			displayName: users.displayName,
			role: users.role,
			isActive: users.isActive,
			failedLoginCount: users.failedLoginCount
		})
		.from(users)
		.where(eq(users.id, id));
	return u;
}

async function auditCount(userId: string, eventType: string) {
	const rows = await db
		.select({ metadata: securityEvents.metadata })
		.from(securityEvents)
		.where(and(eq(securityEvents.userId, userId), eq(securityEvents.eventType, eventType)));
	return rows;
}

// `fail()` returns an ActionFailure (has `.status`/`.data`); a successful action
// returns a plain `{ ok: true }`.
function isFailure(res: unknown): res is { status: number; data: { error?: string } } {
	return typeof res === 'object' && res !== null && 'status' in res;
}

suite('admin user actions (DB)', () => {
	beforeEach(resetDb);

	describe('rename', () => {
		it('renames a user and writes an admin_name_change audit event', async () => {
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Old Name' });

			const res = await actions.rename(
				event(admin.id, { userId: target.id, displayName: 'New Name' })
			);
			expect(res).toEqual({ ok: true });
			expect((await row(target.id)).displayName).toBe('New Name');

			const events = await auditCount(target.id, 'admin_name_change');
			expect(events).toHaveLength(1);
			expect(events[0].metadata).toMatchObject({
				actorUserId: admin.id,
				previousName: 'Old Name',
				newName: 'New Name'
			});
		});

		it('sanitizes the new name (trims and collapses whitespace)', async () => {
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Old Name' });
			await actions.rename(event(admin.id, { userId: target.id, displayName: '  Jo   Bloggs  ' }));
			expect((await row(target.id)).displayName).toBe('Jo Bloggs');
		});

		it('rejects a too-short name and leaves the user unchanged', async () => {
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Keepme' });

			const res = await actions.rename(event(admin.id, { userId: target.id, displayName: 'A' }));
			expect(isFailure(res) && res.status).toBe(400);
			expect(isFailure(res) && res.data.error).toMatch(/at least/i);
			expect((await row(target.id)).displayName).toBe('Keepme');
			expect(await auditCount(target.id, 'admin_name_change')).toHaveLength(0);
		});

		it('no-ops (no audit event) when the name is unchanged', async () => {
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Same Name' });
			const res = await actions.rename(
				event(admin.id, { userId: target.id, displayName: 'Same Name' })
			);
			expect(res).toEqual({ ok: true });
			expect(await auditCount(target.id, 'admin_name_change')).toHaveLength(0);
		});

		it('404s for an unknown user', async () => {
			const admin = await makeAdmin();
			await expect(
				actions.rename(
					event(admin.id, { userId: '00000000-0000-0000-0000-000000000000', displayName: 'Nope' })
				)
			).rejects.toMatchObject({ status: 404 });
		});
	});

	describe('suspend / unsuspend', () => {
		it('suspend deactivates the account and audits it', async () => {
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Victim' });
			const res = await actions.suspend(event(admin.id, { userId: target.id }));
			expect(res).toEqual({ ok: true });
			expect((await row(target.id)).isActive).toBe(false);
			expect(await auditCount(target.id, 'admin_suspend')).toHaveLength(1);
		});

		it('refuses to suspend your own account', async () => {
			const admin = await makeAdmin();
			const res = await actions.suspend(event(admin.id, { userId: admin.id }));
			expect(isFailure(res) && res.status).toBe(400);
			expect((await row(admin.id)).isActive).toBe(true);
		});

		it('unsuspend re-enables the account AND clears the failed-login counter', async () => {
			// Simulates the lockout path: isActive=false with a tripped counter.
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Locked' });
			await db
				.update(users)
				.set({ isActive: false, failedLoginCount: 5 })
				.where(eq(users.id, target.id));

			const res = await actions.unsuspend(event(admin.id, { userId: target.id }));
			expect(res).toEqual({ ok: true });
			const after = await row(target.id);
			expect(after.isActive).toBe(true);
			expect(after.failedLoginCount).toBe(0);
			expect(await auditCount(target.id, 'admin_unsuspend')).toHaveLength(1);
		});
	});

	describe('promote / demote', () => {
		it('promote makes a user an admin and audits the role change', async () => {
			const admin = await makeAdmin();
			const target = await createUser({ displayName: 'Risingstar' });
			const res = await actions.promote(event(admin.id, { userId: target.id }));
			expect(res).toEqual({ ok: true });
			expect((await row(target.id)).role).toBe('admin');
			expect(await auditCount(target.id, 'admin_role_change')).toHaveLength(1);
		});

		it('demote returns an admin to user', async () => {
			const admin = await makeAdmin();
			const other = await makeAdmin(); // a second admin to demote
			const res = await actions.demote(event(admin.id, { userId: other.id }));
			expect(res).toEqual({ ok: true });
			expect((await row(other.id)).role).toBe('user');
		});

		it('refuses to demote your own account', async () => {
			const admin = await makeAdmin();
			const res = await actions.demote(event(admin.id, { userId: admin.id }));
			expect(isFailure(res) && res.status).toBe(400);
			expect((await row(admin.id)).role).toBe('admin');
		});
	});
});
