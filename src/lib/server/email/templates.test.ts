import { describe, it, expect } from 'vitest';
import { verifyEmailTemplate, passwordResetTemplate, friendInviteTemplate } from './templates';

const APP = 'https://crub.example';

describe('verifyEmailTemplate', () => {
	const t = verifyEmailTemplate({
		displayName: 'Carl',
		verifyUrl: `${APP}/verify-email/abc123`,
		expiresInHours: 1,
		appUrl: APP
	});

	it('has a subject mentioning the brand', () => {
		expect(t.subject).toMatch(/Crub Bucks/);
	});

	it('includes the verify URL in both html and text', () => {
		expect(t.html).toContain(`${APP}/verify-email/abc123`);
		expect(t.text).toContain(`${APP}/verify-email/abc123`);
	});

	it('greets the recipient by name', () => {
		expect(t.text).toContain('Carl');
	});

	it('embeds the Cala avatar with an absolute URL', () => {
		expect(t.html).toContain(`${APP}/cala-avatar.png`);
	});

	it('uses the purple brand color on the button', () => {
		expect(t.html.toLowerCase()).toContain('#7c3aed');
	});
});

describe('passwordResetTemplate', () => {
	const t = passwordResetTemplate({
		displayName: 'Dana',
		resetUrl: `${APP}/reset-password/xyz789`,
		expiresInHours: 1,
		appUrl: APP
	});

	it('includes the reset URL in both formats', () => {
		expect(t.html).toContain(`${APP}/reset-password/xyz789`);
		expect(t.text).toContain(`${APP}/reset-password/xyz789`);
	});

	it('notes the one-time / expiry nature', () => {
		expect(t.text.toLowerCase()).toMatch(/once|expire/);
	});

	it("uses Cala's confused portrait — fits the 'forgot your password' moment", () => {
		expect(t.html).toContain(`${APP}/cala-confused.png`);
	});
});

describe('friendInviteTemplate', () => {
	const t = friendInviteTemplate({
		inviterName: 'Theo',
		joinUrl: `${APP}/register?email=new%40example.com`,
		appUrl: APP
	});

	it('names the inviter in the subject', () => {
		expect(t.subject).toContain('Theo');
	});

	it('includes the join URL', () => {
		expect(t.html).toContain(`${APP}/register?email=new%40example.com`);
		expect(t.text).toContain(`${APP}/register?email=new%40example.com`);
	});

	it("uses Cala's envelope portrait — themed for the invitation", () => {
		expect(t.html).toContain(`${APP}/cala-watching.png`);
	});

	it('escapes HTML in user-controlled fields', () => {
		const evil = friendInviteTemplate({
			inviterName: '<script>alert(1)</script>',
			joinUrl: `${APP}/register`,
			appUrl: APP
		});
		expect(evil.html).not.toContain('<script>alert(1)</script>');
		expect(evil.html).toContain('&lt;script&gt;');
	});
});

describe('layout — shared across all templates', () => {
	const t = verifyEmailTemplate({
		displayName: 'Carl',
		verifyUrl: `${APP}/verify-email/abc123`,
		expiresInHours: 1,
		appUrl: APP
	});

	it('marks itself as light-only so dark-mode clients do not invert the palette', () => {
		expect(t.html).toContain('content="light only"');
	});

	it('handles trailing slashes on appUrl without producing double slashes', () => {
		const trailing = verifyEmailTemplate({
			displayName: 'Carl',
			verifyUrl: `${APP}/verify-email/abc123`,
			expiresInHours: 1,
			appUrl: `${APP}/`
		});
		// Should be exactly one slash between origin and /cala-avatar.png
		expect(trailing.html).toContain(`${APP}/cala-avatar.png`);
		expect(trailing.html).not.toContain(`${APP}//cala-avatar.png`);
	});
});
