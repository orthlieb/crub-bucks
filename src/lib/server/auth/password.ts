import argon2 from 'argon2';
import { scryptSync, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// Password hashing
//
// New hashes use Argon2id (the argon2 library's defaults: m=65536 KiB, t=3,
// p=4 — a sound interactive-login profile). Stored values are self-describing
// ("$argon2id$v=19$m=...$..."), so verifyPassword can tell them apart from the
// LEGACY scrypt format ("scrypt$<salt>$<hashHex>") and accept both. Old
// accounts keep working; the login flow rehashes them to Argon2id on the next
// successful sign-in (see needsRehash + the login action's rehash step).
// ---------------------------------------------------------------------------

/** Returns an Argon2id hash string (self-describing, includes salt + params). */
export async function hashPassword(password: string): Promise<string> {
	return argon2.hash(password.normalize('NFKC'), { type: argon2.argon2id });
}

// Legacy scrypt parameters — only used to VERIFY pre-existing scrypt hashes.
const SCRYPT_N = 16384; // 2^14
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const SCRYPT_dkLen = 64;

function deriveScrypt(password: string, salt: string): Buffer {
	return scryptSync(password.normalize('NFKC'), salt, SCRYPT_dkLen, {
		N: SCRYPT_N,
		r: SCRYPT_r,
		p: SCRYPT_p,
		maxmem: 64 * 1024 * 1024
	});
}

/**
 * Verifies a password against a stored hash. Accepts both new Argon2id hashes
 * and legacy `scrypt$<salt>$<hashHex>` values. Never throws — returns false on
 * any malformed or unrecognised input.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	if (typeof stored !== 'string' || stored.length === 0) return false;

	// Argon2 hashes are self-describing and start with "$argon2".
	if (stored.startsWith('$argon2')) {
		try {
			return await argon2.verify(stored, password.normalize('NFKC'));
		} catch {
			return false;
		}
	}

	// Legacy scrypt format: scrypt$<salt>$<hashHex>
	const parts = stored.split('$');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
	const [, salt, expectedHex] = parts;
	const expected = Buffer.from(expectedHex, 'hex');
	const actual = deriveScrypt(password, salt);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * True if a stored hash is not in the current preferred format (i.e. it's a
 * legacy scrypt hash). The login flow calls this after a successful verify to
 * decide whether to transparently rehash the password to Argon2id.
 */
export function needsRehash(stored: string): boolean {
	return !stored.startsWith('$argon2');
}

// ---------------------------------------------------------------------------
// Password policy
// At least 12 characters, at least 5 distinct characters, and not a common /
// easily-guessed password (local denylist — see common-passwords.ts). The
// registration and reset-password flows additionally check HaveIBeenPwned
// (see auth/hibp.ts). The constants live in a client-safe module so form copy
// can render them.
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
 * by response timing alone. The reference hash is computed once, lazily.
 */
let dummyHashPromise: Promise<string> | null = null;
export async function dummyVerify(password: string): Promise<boolean> {
	dummyHashPromise ??= hashPassword('not-a-real-password-but-still-a-hash');
	return verifyPassword(password, await dummyHashPromise);
}
