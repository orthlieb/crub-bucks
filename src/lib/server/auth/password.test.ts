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
