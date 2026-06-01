import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// scrypt parameters. N must be a power of 2; these are reasonable defaults
// for an interactive login on modest hardware.
const N = 16384; // 2^14
const r = 8;
const p = 1;
const dkLen = 64;

function derive(password: string, salt: string): Buffer {
	return scryptSync(password.normalize('NFKC'), salt, dkLen, {
		N,
		r,
		p,
		maxmem: 64 * 1024 * 1024
	});
}

/** Returns a stored value of the form `scrypt$<salt>$<hashHex>`. */
export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	return `scrypt$${salt}$${derive(password, salt).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
	const parts = stored.split('$');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
	const [, salt, expectedHex] = parts;
	const expected = Buffer.from(expectedHex, 'hex');
	const actual = derive(password, salt);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// Password policy
// Mirrors ironledger: at least 12 characters, at least 5 distinct characters,
// and not a common / easily-guessed password (local denylist — see
// common-passwords.ts). HIBP breach checking remains a possible follow-on.
// The constants live in a client-safe module so form copy can render them.
// ---------------------------------------------------------------------------

export { PASSWORD_MIN_LENGTH, PASSWORD_MIN_DISTINCT } from '$lib/auth/password-policy';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_DISTINCT } from '$lib/auth/password-policy';
import { isCommonPassword } from './common-passwords';

export interface PasswordValidationResult {
	ok: boolean;
	message?: string;
}

export function validatePassword(password: string): PasswordValidationResult {
	if (typeof password !== 'string') return { ok: false, message: 'Password is required' };
	if (password.length < PASSWORD_MIN_LENGTH) {
		return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
	}
	const distinct = new Set(password).size;
	if (distinct < PASSWORD_MIN_DISTINCT) {
		return {
			ok: false,
			message: `Password must include at least ${PASSWORD_MIN_DISTINCT} different characters`
		};
	}
	if (isCommonPassword(password)) {
		return {
			ok: false,
			message: 'That password is too common or guessable — please choose another'
		};
	}
	return { ok: true };
}

/**
 * Constant-time-ish dummy verify, used in the login flow when the email is
 * unknown so attackers can't distinguish "no such user" from "wrong password"
 * by response timing alone.
 */
const DUMMY_HASH = hashPassword('not-a-real-password-but-still-a-hash');
export function dummyVerify(password: string): boolean {
	return verifyPassword(password, DUMMY_HASH);
}
