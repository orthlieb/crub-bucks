import { describe, it, expect } from 'vitest';
import {
	hashPassword,
	verifyPassword,
	validatePassword,
	dummyVerify,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MIN_DISTINCT
} from './password';

describe('validatePassword', () => {
	it('rejects passwords shorter than the minimum length', () => {
		const res = validatePassword('aB3$xY'); // 6 chars
		expect(res.ok).toBe(false);
		expect(res.message).toMatch(new RegExp(`${PASSWORD_MIN_LENGTH}`));
	});

	it('rejects passwords with too few distinct characters', () => {
		const res = validatePassword('aaaaaaaaaaaa'); // 12 chars, 1 distinct
		expect(res.ok).toBe(false);
		expect(res.message).toMatch(new RegExp(`${PASSWORD_MIN_DISTINCT}`));
	});

	it('accepts a password meeting both rules', () => {
		expect(validatePassword('correct-horse-battery').ok).toBe(true);
	});

	it('rejects common / guessable passwords (12+ chars)', () => {
		for (const pw of [
			'password1234',
			'P@ssw0rd1234',
			'iloveyou2024!',
			'qwertyuiop123',
			'123456789012',
			'qwerty!!!!!!!',
			'letmein-letmein',
			'administrator',
			'welcome12345'
		]) {
			const res = validatePassword(pw);
			expect(res.ok, pw).toBe(false);
			expect(res.message, pw).toMatch(/common|guess/i);
		}
	});

	it('still accepts strong passphrases that merely contain a common word', () => {
		for (const pw of [
			'correct-horse-battery',
			'velvet-thunder-pickle-9',
			'mypasswordvault-x7y',
			'summit-falcon-river-22'
		]) {
			expect(validatePassword(pw).ok, pw).toBe(true);
		}
	});

	it('rejects non-string input', () => {
		// @ts-expect-error testing runtime guard
		expect(validatePassword(undefined).ok).toBe(false);
	});
});

describe('hashPassword / verifyPassword', () => {
	it('round-trips a correct password', () => {
		const stored = hashPassword('correct-horse-battery');
		expect(verifyPassword('correct-horse-battery', stored)).toBe(true);
	});

	it('rejects the wrong password', () => {
		const stored = hashPassword('correct-horse-battery');
		expect(verifyPassword('wrong-horse-battery', stored)).toBe(false);
	});

	it('produces a unique salt per hash', () => {
		expect(hashPassword('same-password-123')).not.toBe(hashPassword('same-password-123'));
	});

	it('rejects a malformed stored value', () => {
		expect(verifyPassword('whatever', 'not$a$valid$hash')).toBe(false);
		expect(verifyPassword('whatever', 'plain')).toBe(false);
	});
});

describe('dummyVerify', () => {
	it('always returns false (used to equalise timing)', () => {
		expect(dummyVerify('anything')).toBe(false);
	});
});
