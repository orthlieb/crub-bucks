import { eq } from 'drizzle-orm';
import { sha256 } from '@oslojs/crypto/sha2';
import { encodeBase64url, encodeHexLowerCase } from '@oslojs/encoding';
import { db } from '../db';
import { sessions, users } from '../db/schema';
import type { RequestEvent } from '@sveltejs/kit';

const DAY = 1000 * 60 * 60 * 24;
const SESSION_TTL = 30 * DAY;
export const SESSION_COOKIE = 'crub_session';

/** Generate a high-entropy session token to hand to the client. */
export function generateSessionToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	return encodeBase64url(bytes);
}

function tokenToId(token: string): string {
	// We store only the hash of the token; the raw token lives in the cookie.
	return encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
}

export async function createSession(
	token: string,
	userId: string,
	opts: {
		userAgent?: string | null;
		ipAddress?: string | null;
		/** Persist the cookie across browser restarts. Default false. */
		remember?: boolean;
	} = {}
) {
	const id = tokenToId(token);
	const expiresAt = new Date(Date.now() + SESSION_TTL);
	const remember = opts.remember ?? false;
	await db.insert(sessions).values({
		id,
		userId,
		expiresAt,
		remember,
		userAgent: opts.userAgent ?? null,
		ipAddress: opts.ipAddress ?? null
	});
	return { id, userId, expiresAt, remember };
}

/**
 * Returns the session + a slim user projection. Callers don't need the
 * password hash or the lockout counter — that stuff stays in the DB.
 */
export async function validateSessionToken(token: string) {
	const id = tokenToId(token);
	const [row] = await db
		.select({
			session: sessions,
			user: {
				id: users.id,
				email: users.email,
				displayName: users.displayName,
				role: users.role,
				isActive: users.isActive,
				emailVerifiedAt: users.emailVerifiedAt,
				avatarUpdatedAt: users.avatarUpdatedAt,
				avatarIcon: users.avatarIcon
			}
		})
		.from(sessions)
		.innerJoin(users, eq(sessions.userId, users.id))
		.where(eq(sessions.id, id));

	if (!row) return { session: null, user: null };

	// Expired → clean up and reject.
	if (Date.now() >= row.session.expiresAt.getTime()) {
		await db.delete(sessions).where(eq(sessions.id, id));
		return { session: null, user: null };
	}

	// Sliding expiry: renew when within the last half of the window.
	if (Date.now() >= row.session.expiresAt.getTime() - SESSION_TTL / 2) {
		const expiresAt = new Date(Date.now() + SESSION_TTL);
		await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
		row.session.expiresAt = expiresAt;
	}

	return { session: row.session, user: row.user };
}

export async function invalidateSession(token: string) {
	await db.delete(sessions).where(eq(sessions.id, tokenToId(token)));
}

/** Revoke every session for a user — used on password reset / lockout. */
export async function invalidateAllSessionsForUser(userId: string) {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

/**
 * Set the session cookie. When `remember` is true the cookie has an explicit
 * expiry (matches the DB session expiry, so it survives browser restarts);
 * when false we omit `expires` so the browser treats it as a session cookie
 * and discards it when the window closes. Either way the DB row controls
 * server-side validity.
 */
export function setSessionCookie(
	event: RequestEvent,
	token: string,
	expiresAt: Date,
	remember: boolean
) {
	event.cookies.set(SESSION_COOKIE, token, {
		httpOnly: true,
		sameSite: 'lax',
		// `expires` only when "remember me" was ticked. Omitting it leaves
		// the cookie ephemeral so closing the browser logs the user out.
		...(remember ? { expires: expiresAt } : {}),
		path: '/',
		secure: !import.meta.env.DEV
	});
}

export function clearSessionCookie(event: RequestEvent) {
	event.cookies.delete(SESSION_COOKIE, { path: '/' });
}
