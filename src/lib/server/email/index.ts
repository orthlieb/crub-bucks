import { env } from '$env/dynamic/private';
import { getEmailTransport, getAppUrl } from './transport';
import { verifyEmailTemplate, passwordResetTemplate, friendInviteTemplate } from './templates';

/** Where user content reports are delivered. Override with REPORTS_EMAIL. */
const DEFAULT_REPORTS_TO = 'info@crubbucks.com';

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
	const appUrl = getAppUrl();
	const verifyUrl = `${appUrl}/verify-email/${encodeURIComponent(opts.token)}`;
	const msg = verifyEmailTemplate({
		displayName: opts.displayName,
		verifyUrl,
		expiresInHours: VERIFY_EXPIRES_HOURS,
		appUrl
	});
	await getEmailTransport().send({ to: opts.to, ...msg });
}

export async function sendPasswordResetEmail(opts: {
	to: string;
	displayName: string;
	token: string;
}): Promise<void> {
	const appUrl = getAppUrl();
	const resetUrl = `${appUrl}/reset-password/${encodeURIComponent(opts.token)}`;
	const msg = passwordResetTemplate({
		displayName: opts.displayName,
		resetUrl,
		expiresInHours: RESET_EXPIRES_HOURS,
		appUrl
	});
	await getEmailTransport().send({ to: opts.to, ...msg });
}

export async function sendFriendInviteEmail(opts: {
	to: string;
	inviterName: string;
	/** Ties the signup back to this invite even if they use a different email. */
	inviteId: string;
}): Promise<void> {
	const appUrl = getAppUrl();
	const joinUrl = `${appUrl}/register?invite=${encodeURIComponent(opts.inviteId)}&email=${encodeURIComponent(opts.to)}`;
	const msg = friendInviteTemplate({ inviterName: opts.inviterName, joinUrl, appUrl });
	await getEmailTransport().send({ to: opts.to, ...msg });
}

/**
 * Send a content report to the Crub Bucks team (a user flagged an offensive
 * bet or display name). Best-effort — callers wrap in try/catch.
 */
export async function sendReportEmail(opts: {
	reporterName: string;
	reporterEmail: string;
	reporterId: string;
	targetType: 'user' | 'bet';
	targetId: string;
	targetLabel: string;
	/** Snapshot of the offending text (title/note, or the name). */
	content?: string | null;
	reason?: string | null;
}): Promise<void> {
	const to = env.REPORTS_EMAIL?.trim() || DEFAULT_REPORTS_TO;
	const appUrl = getAppUrl();
	const viewUrl = opts.targetType === 'bet' ? `${appUrl}/admin/feed` : `${appUrl}/admin/users`;
	const kind = opts.targetType === 'bet' ? 'a bet' : 'a display name';
	const subject = `[Crub Bucks] Report: ${opts.targetType} — ${opts.targetLabel}`.slice(0, 180);

	const text = [
		`A user reported ${kind}.`,
		'',
		`Type:        ${opts.targetType}`,
		`Target:      ${opts.targetLabel} (id ${opts.targetId})`,
		opts.content ? `Content:     ${opts.content}` : null,
		`Reason:      ${opts.reason || '(none given)'}`,
		'',
		`Reported by: ${opts.reporterName} <${opts.reporterEmail}> (id ${opts.reporterId})`,
		`Review at:   ${viewUrl}`
	]
		.filter((l) => l !== null)
		.join('\n');

	const esc = (s: string) =>
		s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	const row = (k: string, v: string) =>
		`<tr><td style="padding:4px 8px;color:#6b7280"><strong>${k}</strong></td><td style="padding:4px 8px">${v}</td></tr>`;
	const html = `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1f2937">
		<p>A user reported ${kind}.</p>
		<table style="border-collapse:collapse">
			${row('Type', esc(opts.targetType))}
			${row('Target', `${esc(opts.targetLabel)} <span style="color:#6b7280">(id ${esc(opts.targetId)})</span>`)}
			${opts.content ? row('Content', esc(opts.content)) : ''}
			${row('Reason', opts.reason ? esc(opts.reason) : '<em>(none given)</em>')}
			${row('Reporter', `${esc(opts.reporterName)} &lt;${esc(opts.reporterEmail)}&gt; <span style="color:#6b7280">(id ${esc(opts.reporterId)})</span>`)}
			${row('Review', `<a href="${esc(viewUrl)}">${esc(viewUrl)}</a>`)}
		</table>
	</div>`;

	await getEmailTransport().send({ to, subject, html, text });
}

export const EMAIL_TOKEN_EXPIRY = {
	verify: VERIFY_EXPIRES_HOURS,
	reset: RESET_EXPIRES_HOURS
} as const;
