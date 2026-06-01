/**
 * Email templates. Each renderer returns { subject, html, text }. Keep both
 * formats in sync — plaintext is what gets shown in many clients and is the
 * accessible fallback. Templates are intentionally framework-free strings so
 * they can be unit-tested without spinning up SvelteKit.
 *
 * Layout style: purple-branded card with a Cala portrait in a circular
 * avatar at the top, purple button, soft violet outer background. Designed
 * to render the same in modern webmail (Gmail, Apple Mail, Outlook Web) and
 * degrade gracefully in older Outlook desktop. Uses inline CSS only (no
 * <style> blocks — many clients strip them) and table-based layout for
 * legacy Outlook compatibility.
 *
 * Images are served from the app's static directory; callers pass `appUrl`
 * so we can build absolute URLs without coupling templates to env reads.
 */

interface RenderedEmail {
	subject: string;
	html: string;
	text: string;
}

const BRAND = 'Crub Bucks';

// Palette aligned with the web app's purple primary.
const PURPLE = '#7c3aed'; // primary
const PURPLE_DARK = '#6d28d9'; // gradient end
const PURPLE_BG = '#f5f3ff'; // outer page wash (violet-50)
const PURPLE_INK = '#ede9fe'; // header eyebrow text on dark bg
const TEXT_DARK = '#111827';
const TEXT_BODY = '#1f2937';
const TEXT_MUTED = '#6b7280';

interface HeroImage {
	src: string;
	alt: string;
}

function layout(opts: {
	heading: string;
	bodyHtml: string;
	hero: HeroImage;
	preheader?: string;
}): string {
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
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light" />
<title>${escapeHtml(opts.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${PURPLE_BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${TEXT_BODY}">
${preheader}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${PURPLE_BG};padding:32px 16px">
  <tr>
    <td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:16px;box-shadow:0 4px 16px rgba(124,58,237,0.15);overflow:hidden">

        <!-- Header band: purple gradient with circular Cala portrait -->
        <tr>
          <td align="center" style="background:${PURPLE};background-image:linear-gradient(135deg, ${PURPLE} 0%, ${PURPLE_DARK} 100%);padding:32px 32px 24px;text-align:center">
            <img src="${escapeAttr(opts.hero.src)}" alt="${escapeAttr(opts.hero.alt)}" width="120" height="120" style="display:block;margin:0 auto 16px;border-radius:50%;border:4px solid #ffffff;background:#ffffff" />
            <div style="font-size:13px;letter-spacing:0.16em;text-transform:uppercase;color:${PURPLE_INK};font-weight:700">${BRAND}</div>
          </td>
        </tr>

        <!-- Heading + body -->
        <tr>
          <td style="padding:32px 32px 8px;">
            <h1 style="margin:0;font-size:24px;font-weight:700;line-height:1.3;color:${TEXT_DARK}">${escapeHtml(opts.heading)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;font-size:15px;line-height:1.6;color:${TEXT_BODY}">
            ${opts.bodyHtml}
          </td>
        </tr>
      </table>
      <div style="margin-top:16px;font-size:12px;color:${TEXT_MUTED};letter-spacing:0.04em">${BRAND} &middot; closed-loop play currency</div>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function button(label: string, href: string): string {
	// Bulletproof email button: a TD with background colour wraps a padded
	// <a>. The TD's box-shadow is ignored by Outlook but renders nicely
	// everywhere else; the link still works without it.
	return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
  <tr>
    <td style="border-radius:10px;background:${PURPLE};box-shadow:0 6px 16px rgba(124,58,237,0.30)">
      <a href="${escapeAttr(href)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;line-height:1">${escapeHtml(label)}</a>
    </td>
  </tr>
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

/** Strip any trailing slash from appUrl so we can concat `/foo` safely. */
function imgUrl(appUrl: string, path: string): string {
	return `${appUrl.replace(/\/$/, '')}${path}`;
}

export function verifyEmailTemplate(opts: {
	displayName: string;
	verifyUrl: string;
	expiresInHours: number;
	appUrl: string;
}): RenderedEmail {
	const subject = `Verify your ${BRAND} email`;
	const preheader = `Click to verify your email and finish setting up your ${BRAND} account.`;

	const bodyHtml = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(opts.displayName)},</p>
    <p style="margin:0 0 8px">Welcome to ${BRAND}. Confirm this email address to activate your account:</p>
    ${button('Verify email', opts.verifyUrl)}
    <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED}">Or copy this link into your browser:<br />
    <a href="${escapeAttr(opts.verifyUrl)}" style="color:${PURPLE};word-break:break-all">${escapeHtml(opts.verifyUrl)}</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:${TEXT_MUTED}">This link expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'}. If you didn't register for ${BRAND}, you can safely ignore this email.</p>
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

	return {
		subject,
		html: layout({
			heading: 'Verify your email',
			bodyHtml,
			preheader,
			hero: {
				src: imgUrl(opts.appUrl, '/cala-avatar.png'),
				alt: 'Cala the dog — Crub Bucks mascot'
			}
		}),
		text
	};
}

export function friendInviteTemplate(opts: {
	inviterName: string;
	joinUrl: string;
	appUrl: string;
}): RenderedEmail {
	const subject = `${opts.inviterName} invited you to ${BRAND}`;
	const preheader = `${opts.inviterName} wants to settle bets and IOUs with you on ${BRAND}.`;

	const bodyHtml = `
    <p style="margin:0 0 16px"><strong>${escapeHtml(opts.inviterName)}</strong> invited you to ${BRAND} — a closed-loop play currency for settling bets, chores, and IOUs among friends.</p>
    <p style="margin:0 0 8px">Create an account and you'll get a friend request from ${escapeHtml(opts.inviterName)} waiting for you, plus 100 ₡ to start.</p>
    ${button('Join Crub Bucks', opts.joinUrl)}
    <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED}">Or copy this link into your browser:<br />
    <a href="${escapeAttr(opts.joinUrl)}" style="color:${PURPLE};word-break:break-all">${escapeHtml(opts.joinUrl)}</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:${TEXT_MUTED}">Crub Bucks have no real-world value. If you don't know ${escapeHtml(opts.inviterName)}, you can ignore this email.</p>
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

	return {
		subject,
		html: layout({
			heading: `Join ${BRAND}`,
			bodyHtml,
			preheader,
			hero: {
				src: imgUrl(opts.appUrl, '/cala-watching.png'),
				alt: 'Cala the dog holding an envelope'
			}
		}),
		text
	};
}

export function passwordResetTemplate(opts: {
	displayName: string;
	resetUrl: string;
	expiresInHours: number;
	appUrl: string;
}): RenderedEmail {
	const subject = `Reset your ${BRAND} password`;
	const preheader = `Use this link to set a new password. Expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'}.`;

	const bodyHtml = `
    <p style="margin:0 0 16px">Hi ${escapeHtml(opts.displayName)},</p>
    <p style="margin:0 0 8px">We received a request to reset your ${BRAND} password. Click the button below to choose a new one:</p>
    ${button('Reset password', opts.resetUrl)}
    <p style="margin:0 0 8px;font-size:13px;color:${TEXT_MUTED}">Or copy this link into your browser:<br />
    <a href="${escapeAttr(opts.resetUrl)}" style="color:${PURPLE};word-break:break-all">${escapeHtml(opts.resetUrl)}</a></p>
    <p style="margin:16px 0 0;font-size:13px;color:${TEXT_MUTED}">This link expires in ${opts.expiresInHours} hour${opts.expiresInHours === 1 ? '' : 's'} and can only be used once. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
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

	return {
		subject,
		html: layout({
			heading: 'Reset your password',
			bodyHtml,
			preheader,
			hero: {
				src: imgUrl(opts.appUrl, '/cala-confused.png'),
				alt: 'Cala the dog with a question mark above her head'
			}
		}),
		text
	};
}
