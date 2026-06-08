import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users, authTokens } from '$lib/server/db/schema';
import { findValidToken } from '$lib/server/auth/tokens';
import { logSecurityEvent } from '$lib/server/auth/audit';
import { getOrCreateUserWallet } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

/**
 * Verify-email landing. Token is in the URL path. We validate it, stamp
 * users.email_verified_at, mark the token used, and provision the user's
 * wallet (one wallet per user — first-touch creation here means subsequent
 * flows don't have to worry about it).
 *
 * Returns one of:
 *   'ok'      — verified successfully
 *   'invalid' — bad/expired/used token
 */
export const load: PageServerLoad = async (event) => {
	const rawToken = event.params.token;
	const found = await findValidToken({ rawToken, purpose: 'verify_email' });
	if (!found) {
		return { status: 'invalid' as const };
	}

	// Mark verified + consume token atomically.
	await db.transaction(async (tx) => {
		await tx.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, found.userId));
		await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, found.id));
	});

	// Provision wallet outside the tx. Idempotent — safe to call repeatedly.
	await getOrCreateUserWallet(found.userId);

	await logSecurityEvent({
		userId: found.userId,
		eventType: 'email_verified',
		event
	});

	return { status: 'ok' as const };
};
