import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { issueAuthToken, TOKEN_EXPIRY_MS } from '$lib/server/auth/tokens';
import { sendVerificationEmail } from '$lib/server/email';
import { verifyCaptcha } from '$lib/server/captcha';
import { logSecurityEvent } from '$lib/server/auth/audit';
import { getSystemConfig } from '$lib/server/auth/system-config';
import { materializeInvitesForUser } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(302, '/app');
	const config = await getSystemConfig();
	return {
		registrationLocked: config.registrationLock,
		registrationLockMessage: config.registrationLockMessage,
		// Prefill from a friend-invite link (?email=).
		prefillEmail: url.searchParams.get('email') ?? ''
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();
		const displayName = String(form.get('displayName') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const captchaToken = form.get('h-captcha-response');

		// Re-check registration lock at submit time (form could have been open
		// when an admin flipped the switch).
		const config = await getSystemConfig();
		if (config.registrationLock) {
			return fail(403, {
				error:
					config.registrationLockMessage ||
					'Registration is currently closed. Please try again later.',
				email,
				displayName
			});
		}

		// Captcha — server-side verification, with dev no-op when unset.
		const captcha = await verifyCaptcha(
			typeof captchaToken === 'string' ? captchaToken : null,
			event.getClientAddress?.() ?? null
		);
		if (!captcha.ok) {
			return fail(400, {
				error: 'Captcha verification failed. Please try again.',
				email,
				displayName
			});
		}

		// Basic shape checks.
		if (!email || !email.includes('@')) {
			return fail(400, { error: 'A valid email is required.', email, displayName });
		}
		if (displayName.length < 2) {
			return fail(400, {
				error: 'Display name must be at least 2 characters.',
				email,
				displayName
			});
		}
		const pw = validatePassword(password);
		if (!pw.ok) {
			return fail(400, { error: pw.message ?? 'Invalid password.', email, displayName });
		}

		// Look up existing — but ALWAYS respond as if registration succeeded,
		// so an attacker can't enumerate which emails are signed up.
		const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));

		let userId: string;
		if (existing) {
			userId = existing.id;
			// We do NOT re-send a verification email here — the silent-success
			// pattern means an attacker probing emails gets the same response
			// whether or not the email is registered. (Legit users who lost
			// their verify email will use the forgot-password flow, which
			// rotates the password and verifies the email in one step.)
		} else {
			const [created] = await db
				.insert(users)
				.values({
					email,
					displayName,
					passwordHash: hashPassword(password),
					role: 'user',
					isActive: true,
					emailVerifiedAt: null
				})
				.returning({ id: users.id });
			userId = created.id;

			// Issue verification token + send the email. Failures here are logged
			// but not surfaced to the client (same silent-success rationale).
			try {
				const rawToken = await issueAuthToken({
					userId,
					purpose: 'verify_email',
					expiresInMs: TOKEN_EXPIRY_MS.verify_email
				});
				await sendVerificationEmail({ to: email, displayName, token: rawToken });
			} catch (err) {
				console.warn('[register] failed to issue/send verification email:', err);
			}

			// Turn any outstanding friend invites to this email into pending
			// friend requests for the new account.
			try {
				await materializeInvitesForUser(email, userId);
			} catch (err) {
				console.warn('[register] failed to materialize friend invites:', err);
			}

			await logSecurityEvent({
				userId,
				eventType: 'register',
				event,
				metadata: { email }
			});
		}

		// Redirect to a "check your email" page (server-side, no PRG quirks).
		throw redirect(303, '/register/check-email');
	}
};
