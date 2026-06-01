import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword, validatePassword } from '$lib/server/auth/password';
import { sanitizeDisplayName, DISPLAY_NAME_MIN, DISPLAY_NAME_MAX } from '$lib/server/display-name';
import { issueAuthToken, TOKEN_EXPIRY_MS } from '$lib/server/auth/tokens';
import { sendVerificationEmail } from '$lib/server/email';
import { verifyCaptcha } from '$lib/server/captcha';
import { countRegistrationsToday, logSecurityEvent } from '$lib/server/auth/audit';
import { getSystemConfig } from '$lib/server/auth/system-config';
import {
	DEFAULT_DAILY_FULL_MESSAGE,
	evaluateSignupGate
} from '$lib/server/auth/signup-gate';
import { materializeInvitesForUser } from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) throw redirect(302, '/app');
	const config = await getSystemConfig();

	// Surface the soft daily-cap state so the form can disable itself and
	// show a banner before a visitor wastes time filling it in. Skip the
	// count query when the manual lock is on — lock wins anyway, no need
	// to hit security_events.
	let registrationFullToday = false;
	if (!config.registrationLock && config.registrationDailyLimit !== null) {
		const today = await countRegistrationsToday();
		registrationFullToday = today >= config.registrationDailyLimit;
	}

	return {
		registrationLocked: config.registrationLock,
		registrationLockMessage: config.registrationLockMessage,
		registrationFullToday,
		registrationFullTodayMessage:
			config.registrationDailyLimitMessage || DEFAULT_DAILY_FULL_MESSAGE,
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
		const displayName = sanitizeDisplayName(String(form.get('displayName') ?? ''));
		const password = String(form.get('password') ?? '');
		const captchaToken = form.get('h-captcha-response');

		// Re-check both gates at submit time (form could have been open when
		// an admin flipped a switch). Lock + daily cap are evaluated in a
		// single pure helper that pins the precedence — lock wins. Skip
		// the count query when locked, since lock would override anyway.
		// There's a benign race on the daily cap: two concurrent submitters
		// could both pass the check and both succeed, exceeding the cap by
		// one. For an easing-in launch that's acceptable; tightening it
		// would need an advisory lock or counter row.
		const config = await getSystemConfig();
		const countToday =
			!config.registrationLock && config.registrationDailyLimit !== null
				? await countRegistrationsToday()
				: 0;
		const gate = evaluateSignupGate(config, countToday);
		if (!gate.allow) {
			return fail(gate.reason === 'locked' ? 403 : 429, {
				error: gate.message,
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
		if (displayName.length < DISPLAY_NAME_MIN) {
			return fail(400, {
				error: `Display name must be at least ${DISPLAY_NAME_MIN} characters.`,
				email,
				displayName
			});
		}
		if (displayName.length > DISPLAY_NAME_MAX) {
			return fail(400, {
				error: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`,
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
