import { describe, it, expect } from 'vitest';
import { scryptSync } from 'node:crypto';
import {
	hashPassword,
	verifyPassword,
	validatePassword,
	needsRehash,
	dummyVerify,
	PASSWORD_MIN_LENGTH,
	PASSWORD_MIN_DISTINCT
} from './password';

/** Produce a legacy scrypt hash (matching the format password.ts used before
 * the Argon2id migration) so we can assert backward-compatible verification. */
function legacyScryptHash(pw: string): string {
	const salt = 'a'.repeat(32);
	const key = scryptSync(pw.normalize('NFKC'), salt, 64, {
		N: 16384,
		r: 8,
		p: 1,
		maxmem: 64 * 1024 * 1024
	});
	return `scrypt$${salt}$${key.toString('hex')}`;
}

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
	it('produces an Argon2id hash', async () => {
		const stored = await hashPassword('correct-horse-battery');
		expect(stored.startsWith('$argon2id$')).toBe(true);
	});

	it('round-trips a correct password', async () => {
		const stored = await hashPassword('correct-horse-battery');
		expect(await verifyPassword('correct-horse-battery', stored)).toBe(true);
	});

	it('rejects the wrong password', async () => {
		const stored = await hashPassword('correct-horse-battery');
		expect(await verifyPassword('wrong-horse-battery', stored)).toBe(false);
	});

	it('produces a unique hash per call (random salt)', async () => {
		expect(await hashPassword('same-password-123')).not.toBe(
			await hashPassword('same-password-123')
		);
	});

	it('rejects a malformed stored value', async () => {
		expect(await verifyPassword('whatever', 'not$a$valid$hash')).toBe(false);
		expect(await verifyPassword('whatever', 'plain')).toBe(false);
		expect(await verifyPassword('whatever', '')).toBe(false);
	});

	it('still verifies legacy scrypt hashes (backward compatibility)', async () => {
		const legacy = legacyScryptHash('correct-horse-battery');
		expect(await verifyPassword('correct-horse-battery', legacy)).toBe(true);
		expect(await verifyPassword('wrong-horse-battery', legacy)).toBe(false);
	});
});

describe('needsRehash', () => {
	it('flags legacy scrypt hashes for rehashing', () => {
		expect(needsRehash(legacyScryptHash('whatever'))).toBe(true);
	});

	it('does not flag current Argon2id hashes', async () => {
		expect(needsRehash(await hashPassword('whatever'))).toBe(false);
	});
});

describe('dummyVerify', () => {
	it('always returns false (used to equalise timing)', async () => {
		expect(await dummyVerify('anything')).toBe(false);
	});
});
