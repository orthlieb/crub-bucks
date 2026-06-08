import type { RequestEvent } from '@sveltejs/kit';
import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '../db';
import { securityEvents } from '../db/schema';

/**
 * Append-only audit log. userId is nullable so events about deleted users
 * (or unauthenticated requests like a failed login on an unknown email) are
 * still recorded.
 *
 * Event-type vocabulary (keep this list in sync as flows are added):
 *   'register'                          new account created
 *   'email_verified'                    user clicked the verify link
 *   'login_success' / 'login_failure'   self-explanatory
 *   'logout'                            session invalidated by the user
 *   'lockout'                           failedLoginCount crossed threshold
 *   'password_reset_requested'          /forgot-password POST
 *   'password_reset_completed'          /reset-password redeemed
 *   'admin_role_change'                 admin promoted / demoted a user
 *   'admin_suspend' / 'admin_unsuspend' admin toggled isActive
 *   'maintenance_mode_change'           admin toggled maintenance mode
 *   'registration_lock_change'          admin toggled registration lock
 *   'registration_daily_limit_change'   admin set/cleared the per-day signup cap
 *   'notification_sent'                 admin pushed a notification (broadcast or to one user)
 *   'notification_deleted'              admin retracted a notification
 */
export type SecurityEventType =
	| 'register'
	| 'email_verified'
	| 'login_success'
	| 'login_failure'
	| 'logout'
	| 'lockout'
	| 'password_reset_requested'
	| 'password_reset_completed'
	| 'admin_role_change'
	| 'admin_suspend'
	| 'admin_unsuspend'
	| 'admin_balance_set'
	| 'maintenance_mode_change'
	| 'registration_lock_change'
	| 'registration_daily_limit_change'
	| 'notification_sent'
	| 'notification_deleted'
	| 'content_reported';

/** Extract requester IP / UA from a SvelteKit RequestEvent for audit rows. */
export function requestContext(event: RequestEvent): {
	ipAddress: string | null;
	userAgent: string | null;
} {
	let ipAddress: string | null = null;
	try {
		ipAddress = event.getClientAddress();
	} catch {
		// getClientAddress throws if the adapter can't determine an IP — fine.
	}
	const userAgent = event.request.headers.get('user-agent');
	return { ipAddress, userAgent };
}

export async function logSecurityEvent(opts: {
	userId?: string | null;
	eventType: SecurityEventType;
	event?: RequestEvent | null;
	metadata?: Record<string, unknown> | null;
}): Promise<void> {
	const ctx = opts.event ? requestContext(opts.event) : { ipAddress: null, userAgent: null };
	try {
		await db.insert(securityEvents).values({
			userId: opts.userId ?? null,
			eventType: opts.eventType,
			ipAddress: ctx.ipAddress,
			userAgent: ctx.userAgent,
			metadata: opts.metadata ?? null
		});
	} catch (err) {
		// Audit logging should never break the user flow — log and swallow.
		console.warn('[audit] failed to write security event', opts.eventType, err);
	}
}

/**
 * Successful 'register' events since local midnight today. Used by the
 * registration daily-limit enforcement on /register.
 *
 * Backed by the (event_type, created_at) index on security_events, so a
 * range scan with the equality predicate is cheap even with a busy table.
 * "Today" is local server time — picked the same way you'd read a calendar
 * — to match the admin's expectation when they look at the cutover.
 */
export async function countRegistrationsToday(): Promise<number> {
	const startOfDay = new Date();
	startOfDay.setHours(0, 0, 0, 0);
	const [row] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(securityEvents)
		.where(
			and(eq(securityEvents.eventType, 'register'), gte(securityEvents.createdAt, startOfDay))
		);
	return Number(row?.n ?? 0);
}
