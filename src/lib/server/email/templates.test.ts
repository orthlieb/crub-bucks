import { describe, it, expect } from 'vitest';
import {
	verifyEmailTemplate,
	passwordResetTemplate,
	friendInviteTemplate
} from './templates';

describe('verifyEmailTemplate', () => {
	const t = verifyEmailTemplate({
		displayName: 'Carl',
		verifyUrl: 'https://crub.example/verify-email/abc123',
		expiresInHours: 1
	});

	it('has a subject mentioning the brand', () => {
		expect(t.subject).toMatch(/Crub Bucks/);
	});

	it('includes the verify URL in both html and text', () => {
		expect(t.html).toContain('https://crub.example/verify-email/abc123');
		expect(t.text).toContain('https://crub.example/verify-email/abc123');
	});

	it('greets the recipient by name', () => {
		expect(t.text).toContain('Carl');
	});
});

describe('passwordResetTemplate', () => {
	const t = passwordResetTemplate({
		displayName: 'Dana',
		resetUrl: 'https://crub.example/reset-password/xyz789',
		expiresInHours: 1
	});

	it('includes the reset URL in both formats', () => {
		expect(t.html).toContain('https://crub.example/reset-password/xyz789');
		expect(t.text).toContain('https://crub.example/reset-password/xyz789');
	});

	it('notes the one-time / expiry nature', () => {
		expect(t.text.toLowerCase()).toMatch(/once|expire/);
	});
});

describe('friendInviteTemplate', () => {
	const t = friendInviteTemplate({
		inviterName: 'Theo',
		joinUrl: 'https://crub.example/register?email=new%40example.com'
	});

	it('names the inviter in the subject', () => {
		expect(t.subject).toContain('Theo');
	});

	it('includes the join URL', () => {
		expect(t.html).toContain('https://crub.example/register?email=new%40example.com');
		expect(t.text).toContain('https://crub.example/register?email=new%40example.com');
	});

	it('escapes HTML in user-controlled fields', () => {
		const evil = friendInviteTemplate({
			inviterName: '<script>alert(1)</script>',
			joinUrl: 'https://crub.example/register'
		});
		expect(evil.html).not.toContain('<script>alert(1)</script>');
		expect(evil.html).toContain('&lt;script&gt;');
	});
});
