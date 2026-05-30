import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { issueAuthToken, TOKEN_EXPIRY_MS } from '$lib/server/auth/tokens';
import { sendPasswordResetEmail } from '$lib/server/email';
import { verifyCaptcha } from '$lib/server/captcha';
import { logSecurityEvent } from '$lib/server/auth/audit';
import type { Actions } from './$types';

/**
 * Forgot-password endpoint. Behaviour:
 *   - Captcha must pass.
 *   - We look up the user by email. If found AND email is verified, we issue
 *     a reset_password token and email a reset link.
 *   - REGARDLESS of whether the user existed, the response is the same
 *     `{ submitted: true }` shape — this is the standard enumeration-prevention
 *     pattern. Unverified accounts are also silently ignored (verifying the
 *     email IS the recovery path for those).
 */
export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const captchaToken = form.get('h-captcha-response');

		const captcha = await verifyCaptcha(
			typeof captchaToken === 'string' ? captchaToken : null,
			event.getClientAddress?.() ?? null
		);
		if (!captcha.ok) {
			return fail(400, { error: 'Captcha verification failed. Please try again.', email });
		}

		if (!email || !email.includes('@')) {
			return fail(400, { error: 'Please enter a valid email address.', email });
		}

		const [user] = await db
			.select({
				id: users.id,
				email: users.email,
				displayName: users.displayName,
				emailVerifiedAt: users.emailVerifiedAt
			})
			.from(users)
			.where(eq(users.email, email));

		if (user && user.emailVerifiedAt) {
			try {
				const rawToken = await issueAuthToken({
					userId: user.id,
					purpose: 'reset_password',
					expiresInMs: TOKEN_EXPIRY_MS.reset_password
				});
				await sendPasswordResetEmail({
					to: user.email,
					displayName: user.displayName,
					token: rawToken
				});
			} catch (err) {
				console.warn('[forgot-password] failed to issue/send reset email:', err);
			}
			await logSecurityEvent({
				userId: user.id,
				eventType: 'password_reset_requested',
				event,
				metadata: { email }
			});
		} else if (user) {
			// Account exists but email is not verified — log for visibility,
			// but tell the client the same thing.
			await logSecurityEvent({
				userId: user.id,
				eventType: 'password_reset_requested',
				event,
				metadata: { email, ignored: 'email_unverified' }
			});
		} else {
			await logSecurityEvent({
				userId: null,
				eventType: 'password_reset_requested',
				event,
				metadata: { email, ignored: 'unknown_email' }
			});
		}

		return { submitted: true as const };
	}
};
