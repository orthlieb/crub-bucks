import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users, authTokens } from '$lib/server/db/schema';
import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { assertPasswordNotPwned, PwnedPasswordError } from '$lib/server/auth/hibp';
import { findValidToken } from '$lib/server/auth/tokens';
import { invalidateAllSessionsForUser } from '$lib/server/auth/session';
import { logSecurityEvent } from '$lib/server/auth/audit';
import type { Actions, PageServerLoad } from './$types';

/**
 * Reset-password page. The token is in the URL path. On GET we validate the
 * token shape (so we can render an error before the user types anything).
 * On POST we re-validate (token may have been used in the meantime), update
 * the password, mark the token used, clear the failed-login counter,
 * re-enable the account if it had auto-locked, and revoke ALL existing
 * sessions for the user (so a compromised session can't survive the reset).
 */

export const load: PageServerLoad = async ({ params }) => {
	const found = await findValidToken({ rawToken: params.token, purpose: 'reset_password' });
	return { tokenValid: Boolean(found) };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const password = String(form.get('password') ?? '');
		const confirmPassword = String(form.get('confirmPassword') ?? '');

		const found = await findValidToken({
			rawToken: event.params.token,
			purpose: 'reset_password'
		});
		if (!found) {
			return fail(400, {
				error: 'This reset link is invalid, expired, or has already been used.'
			});
		}

		if (password !== confirmPassword) {
			return fail(400, { error: 'Passwords do not match.' });
		}
		const pw = validatePassword(password);
		if (!pw.ok) {
			return fail(400, { error: pw.message ?? 'Invalid password.' });
		}
		// Reject passwords found in known breaches (fail-open if HIBP is down).
		try {
			await assertPasswordNotPwned(password);
		} catch (err) {
			if (err instanceof PwnedPasswordError) {
				return fail(400, { error: err.message });
			}
			throw err;
		}

		const passwordHash = await hashPassword(password);

		await db.transaction(async (tx) => {
			await tx
				.update(users)
				.set({
					passwordHash,
					// Successful recovery → un-lock the account and reset the counter.
					isActive: true,
					failedLoginCount: 0
				})
				.where(eq(users.id, found.userId));
			await tx.update(authTokens).set({ usedAt: new Date() }).where(eq(authTokens.id, found.id));
		});

		// Revoke every existing session so a hijacked session can't ride
		// through the password change.
		await invalidateAllSessionsForUser(found.userId);

		await logSecurityEvent({
			userId: found.userId,
			eventType: 'password_reset_completed',
			event
		});

		throw redirect(303, '/login?reset=ok');
	}
};
