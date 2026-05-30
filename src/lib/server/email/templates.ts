/**
 * Email templates. Each renderer returns { subject, html, text }. Keep both
 * formats in sync — plaintext is what gets shown in many clients and is the
 * accessible fallback. Templates are intentionally framework-free strings so
 * they can be unit-tested without spinning up SvelteKit.
 */

interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

const BRAND = 'Crub Bucks';

function layout(opts: { heading: string; bodyHtml: string; preheader?: string }): string {
	const preheader = opts.preheader
		? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(
				opts.preheader
			)}</div>`
		: '';
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2937">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:32px 16px">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);overflow:hidden">
        <tr>
          <td style="padding:32px 32px 0 32px">
            <div style="font-size:14px;letter-spacing:0.04em;text-transform:uppercase;color:#6b7280;font-weight:600">${BRAND}</div>
            <h1 style="margin:8px 0 16px 0;font-size:22px;line-height:1.3;color:#111827">${escapeHtml(opts.heading)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px 32px;font-size:15px;line-height:1.6">
            ${opts.bodyHtml}
          </td>
        </tr>
      </table>
      <div style="margin-top:16px;font-size:12px;color:#9ca3af">${BRAND} &middot; closed-loop play currency</div>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function button(label: string, href: string): string {
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0">
  <tr><td style="border-radius:8px;background:#111827">
    <a href="${escapeAttr(href)}" style="display:inline-block;padding:12px 20px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px">${escapeHtml(label)}</a>
  </td></tr>
</table>`;
}

function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
	return escapeHtml(s);
}

export function verifyEmailTemplate(opts: {
	displayName: string;
	verifyUrl: string;
	expiresInHours: number;
}): RenderedEmail {
	const subject = `Verify your ${BRAND} email`;
	const preheader = `Click to verify your email and finish setting up your ${BRAND} account.`;

	const bodyHtml = `
    <p>Hi ${escapeHtml(opts.displayName)},</p>
    <p>Welcome to ${BRAND}. Confirm this email address to activate your account:</p>
    ${button('Verify email', opts.verifyUrl)}
    <p style="font-size:13px;color:#6b7280">Or copy this link into your browser:<br />
    <a href="${escapeAttr(opts.verifyUrl)}" style="color:#2563eb;word-break:break-all">${escapeHtml(opts.verifyUrl)}</a></p>
    <p style="font-size:13px;color:#6b7280">This link expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'}. If you didn't register for ${BRAND}, you can safely ignore this email.</p>
  `;

	const text = [
		`Hi ${opts.displayName},`,
		'',
		`Welcome to ${BRAND}. Confirm this email address to activate your account:`,
		'',
		opts.verifyUrl,
		'',
		`This link expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'}. If you didn't register for ${BRAND}, you can ignore this email.`
	].join('\n');

	return { subject, html: layout({ heading: 'Verify your email', bodyHtml, preheader }), text };
}

export function friendInviteTemplate(opts: {
	inviterName: string;
	joinUrl: string;
}): RenderedEmail {
	const subject = `${opts.inviterName} invited you to ${BRAND}`;
	const preheader = `${opts.inviterName} wants to settle bets and IOUs with you on ${BRAND}.`;

	const bodyHtml = `
    <p><strong>${escapeHtml(opts.inviterName)}</strong> invited you to ${BRAND} — a closed-loop play currency for settling bets, chores, and IOUs among friends.</p>
    <p>Create an account and you'll get a friend request from ${escapeHtml(opts.inviterName)} waiting for you, plus 100 CB to start.</p>
    ${button('Join Crub Bucks', opts.joinUrl)}
    <p style="font-size:13px;color:#6b7280">Or copy this link into your browser:<br />
    <a href="${escapeAttr(opts.joinUrl)}" style="color:#2563eb;word-break:break-all">${escapeHtml(opts.joinUrl)}</a></p>
    <p style="font-size:13px;color:#6b7280">Crub Bucks have no real-world value. If you don't know ${escapeHtml(opts.inviterName)}, you can ignore this email.</p>
  `;

	const text = [
		`${opts.inviterName} invited you to ${BRAND} — a closed-loop play currency for bets and IOUs among friends.`,
		'',
		`Create an account and a friend request from ${opts.inviterName} will be waiting, plus 100 CB to start:`,
		'',
		opts.joinUrl,
		'',
		`Crub Bucks have no real-world value. If you don't know ${opts.inviterName}, you can ignore this email.`
	].join('\n');

	return { subject, html: layout({ heading: `Join ${BRAND}`, bodyHtml, preheader }), text };
}

export function passwordResetTemplate(opts: {
	displayName: string;
	resetUrl: string;
	expiresInHours: number;
}): RenderedEmail {
	const subject = `Reset your ${BRAND} password`;
	const preheader = `Use this link to set a new password. Expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'}.`;

	const bodyHtml = `
    <p>Hi ${escapeHtml(opts.displayName)},</p>
    <p>We received a request to reset your ${BRAND} password. Click the button below to choose a new one:</p>
    ${button('Reset password', opts.resetUrl)}
    <p style="font-size:13px;color:#6b7280">Or copy this link into your browser:<br />
    <a href="${escapeAttr(opts.resetUrl)}" style="color:#2563eb;word-break:break-all">${escapeHtml(opts.resetUrl)}</a></p>
    <p style="font-size:13px;color:#6b7280">This link expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'} and can only be used once. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
  `;

	const text = [
		`Hi ${opts.displayName},`,
		'',
		`We received a request to reset your ${BRAND} password. Use this link to choose a new one:`,
		'',
		opts.resetUrl,
		'',
		`This link expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'} and can only be used once. If you didn't request a reset, you can ignore this email.`
	].join('\n');

	return { subject, html: layout({ heading: 'Reset your password', bodyHtml, preheader }), text };
}
