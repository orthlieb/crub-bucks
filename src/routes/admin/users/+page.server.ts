import { error, fail } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { invalidateAllSessionsForUser } from '$lib/server/auth/session';
import { logSecurityEvent } from '$lib/server/auth/audit';
import { adminSetBalance, allUserBalances, LedgerError } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [rows, balances] = await Promise.all([
		db
			.select({
				id: users.id,
				email: users.email,
				displayName: users.displayName,
				role: users.role,
				isActive: users.isActive,
				emailVerifiedAt: users.emailVerifiedAt,
				lastLoginAt: users.lastLoginAt,
				createdAt: users.createdAt,
				failedLoginCount: users.failedLoginCount
			})
			.from(users)
			.orderBy(desc(users.createdAt)),
		allUserBalances()
	]);
	return { users: rows.map((u) => ({ ...u, balance: balances.get(u.id) ?? 0 })) };
};

async function loadUser(id: string) {
	const [row] = await db
		.select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
		.from(users)
		.where(eq(users.id, id));
	return row ?? null;
}

export const actions: Actions = {
	suspend: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('userId') ?? '');
		const target = await loadUser(id);
		if (!target) throw error(404, 'User not found');
		if (target.id === event.locals.user?.id) {
			return fail(400, { error: 'You cannot suspend your own account.' });
		}
		await db.update(users).set({ isActive: false }).where(eq(users.id, id));
		await invalidateAllSessionsForUser(id);
		await logSecurityEvent({
			userId: id,
			eventType: 'admin_suspend',
			event,
			metadata: { actorUserId: event.locals.user?.id, targetEmail: target.email }
		});
		return { ok: true as const };
	},

	unsuspend: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('userId') ?? '');
		const target = await loadUser(id);
		if (!target) throw error(404, 'User not found');
		await db
			.update(users)
			.set({ isActive: true, failedLoginCount: 0 })
			.where(eq(users.id, id));
		await logSecurityEvent({
			userId: id,
			eventType: 'admin_unsuspend',
			event,
			metadata: { actorUserId: event.locals.user?.id, targetEmail: target.email }
		});
		return { ok: true as const };
	},

	promote: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('userId') ?? '');
		const target = await loadUser(id);
		if (!target) throw error(404, 'User not found');
		const previousRole = target.role;
		if (previousRole === 'admin') return { ok: true as const };
		await db.update(users).set({ role: 'admin' }).where(eq(users.id, id));
		await logSecurityEvent({
			userId: id,
			eventType: 'admin_role_change',
			event,
			metadata: {
				actorUserId: event.locals.user?.id,
				targetEmail: target.email,
				previousRole,
				newRole: 'admin'
			}
		});
		return { ok: true as const };
	},

	setBalance: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('userId') ?? '');
		const raw = String(form.get('balance') ?? '').trim();
		const target = await loadUser(id);
		if (!target) throw error(404, 'User not found');
		if (!/^-?\d+$/.test(raw)) {
			return fail(400, { error: 'Enter a whole number balance (it can be negative).' });
		}
		let result;
		try {
			result = await adminSetBalance({
				adminId: event.locals.user!.id,
				userId: id,
				target: Number(raw)
			});
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message });
			throw e;
		}
		await logSecurityEvent({
			userId: id,
			eventType: 'admin_balance_set',
			event,
			metadata: {
				actorUserId: event.locals.user?.id,
				targetEmail: target.email,
				previous: result.previous,
				next: result.next,
				delta: result.delta
			}
		});
		return { ok: true as const };
	},

	demote: async (event) => {
		const form = await event.request.formData();
		const id = String(form.get('userId') ?? '');
		const target = await loadUser(id);
		if (!target) throw error(404, 'User not found');
		if (target.id === event.locals.user?.id) {
			return fail(400, { error: 'You cannot demote your own account.' });
		}
		const previousRole = target.role;
		if (previousRole !== 'admin') return { ok: true as const };
		await db.update(users).set({ role: 'user' }).where(eq(users.id, id));
		await logSecurityEvent({
			userId: id,
			eventType: 'admin_role_change',
			event,
			metadata: {
				actorUserId: event.locals.user?.id,
				targetEmail: target.email,
				previousRole,
				newRole: 'user'
			}
		});
		return { ok: true as const };
	}
};
