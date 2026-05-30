import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from './db';
import { notificationDismissals, notifications, users } from './db/schema';

/**
 * Notifications: short messages shown to users at the top of /app pages.
 * One table powers both flavors:
 *   - userId NULL  → broadcast (everyone sees it; each user dismisses for
 *                    themselves via notification_dismissals)
 *   - userId set   → targeted (only that user sees it; dismissing makes it
 *                    vanish for them only)
 *
 * Sources:
 *   - admin-sent (broadcast or targeted) — createdBy points at the admin
 *   - system-generated (createdBy NULL) — e.g. the welcome grant message,
 *     created right after the 100 ₡ grant is issued
 *
 * Dismissals stack up indefinitely. We don't garbage-collect, but the table
 * stays small in practice (it's bounded by users × active notifications).
 */

export type NotificationLevel = 'info' | 'success' | 'warning';

export interface Notification {
	id: string;
	level: NotificationLevel;
	title: string;
	body: string | null;
	createdAt: Date;
	isBroadcast: boolean;
}

export interface AdminNotificationRow extends Notification {
	userId: string | null;
	recipientName: string | null;
	createdBy: string | null;
	createdByName: string | null;
	dismissCount: number;
}

interface CreateInput {
	level?: NotificationLevel;
	title: string;
	body?: string | null;
	// null = broadcast; otherwise targeted at this user
	userId?: string | null;
	// null = system-generated (e.g. welcome grant); otherwise the acting admin
	createdBy?: string | null;
}

export async function createNotification(input: CreateInput): Promise<string> {
	const [row] = await db
		.insert(notifications)
		.values({
			level: input.level ?? 'info',
			title: input.title,
			body: input.body ?? null,
			userId: input.userId ?? null,
			createdBy: input.createdBy ?? null
		})
		.returning({ id: notifications.id });
	return row.id;
}

/**
 * Active notifications for one user, newest first. Includes:
 *   - all broadcasts not dismissed by this user
 *   - all targeted notifications for this user not dismissed
 */
export async function listActiveForUser(userId: string): Promise<Notification[]> {
	const rows = await db
		.select({
			id: notifications.id,
			level: notifications.level,
			title: notifications.title,
			body: notifications.body,
			createdAt: notifications.createdAt,
			userId: notifications.userId
		})
		.from(notifications)
		.leftJoin(
			notificationDismissals,
			and(
				eq(notificationDismissals.notificationId, notifications.id),
				eq(notificationDismissals.userId, userId)
			)
		)
		.where(
			and(
				or(isNull(notifications.userId), eq(notifications.userId, userId)),
				isNull(notificationDismissals.notificationId)
			)
		)
		.orderBy(desc(notifications.createdAt));

	return rows.map((r) => ({
		id: r.id,
		level: r.level,
		title: r.title,
		body: r.body,
		createdAt: r.createdAt,
		isBroadcast: r.userId === null
	}));
}

/**
 * User dismisses a notification for themselves. Idempotent — repeat dismisses
 * are a no-op. For broadcasts this only hides it for the calling user.
 * Returns false if the notification doesn't exist or isn't visible to them.
 */
export async function dismissForUser(notificationId: string, userId: string): Promise<boolean> {
	// Guard: only allow dismissing a row the user is actually entitled to see.
	const [n] = await db
		.select({ id: notifications.id, userId: notifications.userId })
		.from(notifications)
		.where(eq(notifications.id, notificationId))
		.limit(1);
	if (!n) return false;
	if (n.userId !== null && n.userId !== userId) return false;

	await db
		.insert(notificationDismissals)
		.values({ notificationId, userId })
		.onConflictDoNothing();
	return true;
}

/**
 * Admin retracts a notification entirely. Deleting cascades any dismissals.
 */
export async function deleteNotification(notificationId: string): Promise<void> {
	await db.delete(notifications).where(eq(notifications.id, notificationId));
}

/**
 * Admin's view of every active notification (no dismiss-filter; dismissals
 * are per-user and irrelevant to admins). Newest first, with recipient and
 * sender display names + a count of how many users have dismissed it.
 */
export async function listAllForAdmin(limit = 50): Promise<AdminNotificationRow[]> {
	const recipient = sql`recipient`;
	const sender = sql`sender`;
	const rows = await db
		.select({
			id: notifications.id,
			level: notifications.level,
			title: notifications.title,
			body: notifications.body,
			createdAt: notifications.createdAt,
			userId: notifications.userId,
			createdBy: notifications.createdBy,
			recipientName: sql<string | null>`recipient.display_name`,
			createdByName: sql<string | null>`sender.display_name`,
			dismissCount: sql<number>`(
				select count(*)::int from notification_dismissals
				where notification_dismissals.notification_id = ${notifications.id}
			)`
		})
		.from(notifications)
		.leftJoin(sql`${users} as recipient`, sql`${notifications.userId} = ${recipient}.id`)
		.leftJoin(sql`${users} as sender`, sql`${notifications.createdBy} = ${sender}.id`)
		.orderBy(desc(notifications.createdAt))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		level: r.level,
		title: r.title,
		body: r.body,
		createdAt: r.createdAt,
		userId: r.userId,
		recipientName: r.recipientName,
		createdBy: r.createdBy,
		createdByName: r.createdByName,
		dismissCount: Number(r.dismissCount ?? 0),
		isBroadcast: r.userId === null
	}));
}
