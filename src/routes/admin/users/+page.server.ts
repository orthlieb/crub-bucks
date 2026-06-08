import { error, fail } from '@sveltejs/kit';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { invalidateAllSessionsForUser } from '$lib/server/auth/session';
import { logSecurityEvent } from '$lib/server/auth/audit';
import { adminSetBalance, userBalancesFor, LedgerError } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

const PAGE_SIZE = 25;
const ROLES = ['user', 'admin'] as const;
const STATUSES = ['active', 'suspended', 'unverified'] as const;

export const load: PageServerLoad = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	const roleParam = url.searchParams.get('role') ?? '';
	const statusParam = url.searchParams.get('status') ?? '';
	const role = (ROLES as readonly string[]).includes(roleParam) ? roleParam : '';
	const status = (STATUSES as readonly string[]).includes(statusParam) ? statusParam : '';
	const page = Math.max(1, Number(url.searchParams.get('page')) || 1);

	const conds: SQL[] = [];
	if (q) {
		const like = `%${q.toLowerCase()}%`;
		conds.push(
			sql`(lower(${users.email}) like ${like} or lower(${users.displayName}) like ${like})`
		);
	}
	if (role === 'user' || role === 'admin') conds.push(eq(users.role, role));
	if (status === 'active') {
		conds.push(eq(users.isActive, true));
		conds.push(sql`${users.emailVerifiedAt} is not null`);
	} else if (status === 'suspended') {
		conds.push(eq(users.isActive, false));
	} else if (status === 'unverified') {
		conds.push(sql`${users.emailVerifiedAt} is null`);
	}
	const where = conds.length ? and(...conds) : undefined;

	const [[totalRow], rows] = await Promise.all([
		db.select({ n: count() }).from(users).where(where),
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
			.where(where)
			.orderBy(desc(users.createdAt))
			.limit(PAGE_SIZE)
			.offset((page - 1) * PAGE_SIZE)
	]);

	// Balances only for the visible page (not the whole ledger).
	const balances = await userBalancesFor(rows.map((u) => u.id));

	return {
		users: rows.map((u) => ({ ...u, balance: balances.get(u.id) ?? 0 })),
		total: Number(totalRow?.n ?? 0),
		page,
		pageSize: PAGE_SIZE,
		q,
		role,
		status
	};
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
		await db.update(users).set({ isActive: true, failedLoginCount: 0 }).where(eq(users.id, id));
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
