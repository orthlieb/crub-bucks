import webpush from 'web-push';
import { env as priv } from '$env/dynamic/private';
import { env as pub } from '$env/dynamic/public';
import { and, eq } from 'drizzle-orm';
import { db } from './db';
import { pushSubscriptions } from './db/schema';

/**
 * Web Push (standards-based, VAPID). Stores per-device subscriptions and fans a
 * notification out to all of a user's devices. See docs/push-notifications.md.
 */

let configured = false;
function ensureConfigured(): boolean {
	if (configured) return true;
	if (!pub.PUBLIC_VAPID_KEY || !priv.VAPID_PRIVATE_KEY || !priv.VAPID_SUBJECT) return false;
	webpush.setVapidDetails(priv.VAPID_SUBJECT, pub.PUBLIC_VAPID_KEY, priv.VAPID_PRIVATE_KEY);
	configured = true;
	return true;
}

/** Whether VAPID keys are present (push can be sent at all). */
export function pushConfigured(): boolean {
	return ensureConfigured();
}

/** Shape posted by the client (a serialized PushSubscription). */
export interface PushSubscriptionInput {
	endpoint: string;
	keys: { p256dh: string; auth: string };
}

export function isValidSubscription(x: unknown): x is PushSubscriptionInput {
	const s = x as PushSubscriptionInput;
	return !!s && typeof s.endpoint === 'string' && !!s.keys?.p256dh && !!s.keys?.auth;
}

/** Upsert a device subscription for a user (endpoint is unique). */
export async function savePushSubscription(
	userId: string,
	sub: PushSubscriptionInput,
	userAgent: string | null
): Promise<void> {
	await db
		.insert(pushSubscriptions)
		.values({
			userId,
			endpoint: sub.endpoint,
			p256dh: sub.keys.p256dh,
			auth: sub.keys.auth,
			userAgent
		})
		.onConflictDoUpdate({
			target: pushSubscriptions.endpoint,
			set: {
				userId,
				p256dh: sub.keys.p256dh,
				auth: sub.keys.auth,
				userAgent,
				lastSeenAt: new Date()
			}
		});
}

/** Remove a device subscription (on the user's own logout / disable). */
export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
	await db
		.delete(pushSubscriptions)
		.where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.userId, userId)));
}

export interface PushPayload {
	title: string;
	body?: string | null;
	url?: string | null;
	tag?: string;
}

/**
 * Fan a notification out to every device the user has subscribed. Best-effort:
 * a failed send never throws to the caller; dead endpoints (404/410) are pruned.
 * Not yet wired into createNotification — that hook lands in Phase 2.
 */
export async function sendWebPush(userId: string, payload: PushPayload): Promise<number> {
	if (!ensureConfigured()) return 0;
	const subs = await db
		.select()
		.from(pushSubscriptions)
		.where(eq(pushSubscriptions.userId, userId));
	if (subs.length === 0) return 0;

	const body = JSON.stringify({
		title: payload.title,
		body: payload.body ?? undefined,
		url: payload.url ?? '/app',
		tag: payload.tag
	});

	await Promise.all(
		subs.map(async (s) => {
			try {
				await webpush.sendNotification(
					{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
					body
				);
			} catch (err) {
				const code = (err as { statusCode?: number }).statusCode;
				if (code === 404 || code === 410) {
					await db
						.delete(pushSubscriptions)
						.where(eq(pushSubscriptions.endpoint, s.endpoint))
						.catch(() => {});
				} else {
					console.warn('[push] send failed:', code ?? err);
				}
			}
		})
	);
	return subs.length;
}
