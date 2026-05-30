import { getEmailTransport, getAppUrl } from './transport';
import { verifyEmailTemplate, passwordResetTemplate, friendInviteTemplate } from './templates';

export type { EmailMessage, EmailTransport } from './transport';
export { getEmailTransport, setEmailTransport, getAppUrl } from './transport';

/**
 * High-level email helpers. Auth routes call these — they should never need
 * to talk to a transport or template directly.
 *
 * Tokens are the *raw* tokens (not the hashed form stored in the DB). The
 * raw token is included only in the URL inside the email; it never gets
 * logged in non-console transports.
 */

const VERIFY_EXPIRES_HOURS = 1;
const RESET_EXPIRES_HOURS = 1;

export async function sendVerificationEmail(opts: {
	to: string;
	displayName: string;
	token: string;
}): Promise<void> {
	const verifyUrl = `${getAppUrl()}/verify-email/${encodeURIComponent(opts.token)}`;
	const msg = verifyEmailTemplate({
		displayName: opts.displayName,
		verifyUrl,
		expiresInHours: VERIFY_EXPIRES_HOURS
	});
	await getEmailTransport().send({ to: opts.to, ...msg });
}

export async function sendPasswordResetEmail(opts: {
	to: string;
	displayName: string;
	token: string;
}): Promise<void> {
	const resetUrl = `${getAppUrl()}/reset-password/${encodeURIComponent(opts.token)}`;
	const msg = passwordResetTemplate({
		displayName: opts.displayName,
		resetUrl,
		expiresInHours: RESET_EXPIRES_HOURS
	});
	await getEmailTransport().send({ to: opts.to, ...msg });
}

export async function sendFriendInviteEmail(opts: {
	to: string;
	inviterName: string;
}): Promise<void> {
	const joinUrl = `${getAppUrl()}/register?email=${encodeURIComponent(opts.to)}`;
	const msg = friendInviteTemplate({ inviterName: opts.inviterName, joinUrl });
	await getEmailTransport().send({ to: opts.to, ...msg });
}

export const EMAIL_TOKEN_EXPIRY = {
	verify: VERIFY_EXPIRES_HOURS,
	reset: RESET_EXPIRES_HOURS
} as const;
