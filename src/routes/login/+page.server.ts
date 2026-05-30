import { fail, redirect } from '@sveltejs/kit';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { verifyPassword, dummyVerify } from '$lib/server/auth/password';
import {
	generateSessionToken,
	createSession,
	setSessionCookie
} from '$lib/server/auth/session';
import { verifyCaptcha } from '$lib/server/captcha';
import { logSecurityEvent } from '$lib/server/auth/audit';
import { grantWelcomeIfNeeded } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

const LOCKOUT_THRESHOLD = 5;

const GENERIC_LOGIN_FAILURE = 'Invalid email or password.';

export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) throw redirect(302, '/app');
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(form.get('password') ?? '');
		const captchaToken = form.get('h-captcha-response');

		// Captcha first — cheap reject for bots before we touch the DB.
		const captcha = await verifyCaptcha(
			typeof captchaToken === 'string' ? captchaToken : null,
			event.getClientAddress?.() ?? null
		);
		if (!captcha.ok) {
			return fail(400, { error: 'Captcha verification failed. Please try again.', email });
		}

		const [user] = await db
			.select({
				id: users.id,
				email: users.email,
				displayName: users.displayName,
				passwordHash: users.passwordHash,
				isActive: users.isActive,
				emailVerifiedAt: users.emailVerifiedAt,
				failedLoginCount: users.failedLoginCount
			})
			.from(users)
			.where(eq(users.email, email));

		// Unknown email: spend the time of a real verify to keep response time
		// consistent, then return the generic failure message.
		if (!user) {
			dummyVerify(password);
			await logSecurityEvent({
				userId: null,
				eventType: 'login_failure',
				event,
				metadata: { email, reason: 'unknown_email' }
			});
			return fail(400, { error: GENERIC_LOGIN_FAILURE, email });
		}

		// Known email, wrong password → bump counter, maybe lock out.
		if (!verifyPassword(password, user.passwordHash)) {
			const newCount = user.failedLoginCount + 1;
			const shouldLock = newCount >= LOCKOUT_THRESHOLD && user.isActive;
			await db
				.update(users)
				.set({
					failedLoginCount: newCount,
					...(shouldLock ? { isActive: false } : {})
				})
				.where(eq(users.id, user.id));

			await logSecurityEvent({
				userId: user.id,
				eventType: 'login_failure',
				event,
				metadata: { reason: 'wrong_password', failedLoginCount: newCount }
			});

			if (shouldLock) {
				await logSecurityEvent({
					userId: user.id,
					eventType: 'lockout',
					event,
					metadata: { failedLoginCount: newCount, threshold: LOCKOUT_THRESHOLD }
				});
			}

			return fail(400, { error: GENERIC_LOGIN_FAILURE, email });
		}

		// Password correct. Run the account-state gates in order:
		// (1) suspended/locked, (2) email unverified.
		if (!user.isActive) {
			await logSecurityEvent({
				userId: user.id,
				eventType: 'login_failure',
				event,
				metadata: { reason: 'inactive' }
			});
			return fail(403, {
				error: 'Your account has been suspended. Please contact an administrator.',
				email
			});
		}

		if (!user.emailVerifiedAt) {
			await logSecurityEvent({
				userId: user.id,
				eventType: 'login_failure',
				event,
				metadata: { reason: 'email_unverified' }
			});
			return fail(403, {
				error:
					'Please verify your email before logging in. Check the inbox for the address you registered with.',
				email
			});
		}

		// All gates clear. Grant the 100 CB welcome bonus on first login
		// (idempotent — only fires once per user, bank offset -100).
		try {
			await grantWelcomeIfNeeded(user.id);
		} catch (err) {
			console.warn('[login] welcome grant failed (non-fatal):', err);
		}

		await db
			.update(users)
			.set({ failedLoginCount: 0, lastLoginAt: sql`now()` })
			.where(eq(users.id, user.id));

		const token = generateSessionToken();
		const session = await createSession(token, user.id, {
			userAgent: event.request.headers.get('user-agent'),
			ipAddress: event.getClientAddress?.() ?? null
		});
		setSessionCookie(event, token, session.expiresAt);

		await logSecurityEvent({
			userId: user.id,
			eventType: 'login_success',
			event
		});

		throw redirect(303, '/app');
	}
};
