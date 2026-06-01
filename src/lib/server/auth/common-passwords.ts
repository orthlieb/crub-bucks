/**
 * Reject common / easily-guessed passwords at registration.
 *
 * This is a local denylist (no network), complementing the length + distinct
 * character rules. Two layers:
 *   1. Exact match against a set of well-known weak passwords (keyboard walks,
 *      numeric runs, doubled words) that can otherwise slip past the length gate.
 *   2. A "core word" check: strip surrounding digits/symbols, undo common
 *      leetspeak, collapse a doubled word, and reject if what remains is a
 *      common base word (so "P@ssw0rd1234", "iloveyou2024", "qwerty!!!" all go).
 *
 * The goal is to catch the obvious stuff without rejecting genuine passphrases —
 * the core check matches the base word *exactly*, not as a substring, so
 * "mypasswordvault" is fine while "password1234" is not.
 */

// Frequently-breached passwords, lowercased. Includes 12+ char variants and
// numeric/keyboard patterns that pass the length + distinct-char rules.
const COMMON_PASSWORDS = new Set<string>([
	'password',
	'password1',
	'password12',
	'password123',
	'password1234',
	'passw0rd123',
	'p@ssw0rd123',
	'passwordpassword',
	'123456',
	'1234567',
	'12345678',
	'123456789',
	'1234567890',
	'12345678910',
	'123456789012',
	'1234567890123',
	'12345678901234',
	'098765432109',
	'111111111111',
	'123123123123',
	'121212121212',
	'000000000000',
	'qwertyuiop',
	'qwertyuiop12',
	'qwertyuiop123',
	'qwertyuiopasdfgh',
	'1qaz2wsx3edc',
	'1q2w3e4r5t6y',
	'qazwsxedcrfv',
	'zaq12wsxcde3',
	'asdfghjkl123',
	'qwertyuiopasdfghjkl',
	'iloveyou123',
	'iloveyou1234',
	'letmein12345',
	'welcome12345',
	'trustno1234',
	'administrator',
	'changeme1234',
	'whateverwhatever',
	'abcdefghijkl',
	'abcdefghijklm',
	'abcd1234abcd',
	'aaaaaaaaaaaa1',
	'passwordqwerty',
	'qwertypassword'
]);

// Common base words. After stripping surrounding digits/symbols, undoing
// leetspeak, and collapsing a doubled word, an exact match here is rejected.
const COMMON_BASES = new Set<string>([
	'password',
	'passwd',
	'pass',
	'qwerty',
	'qwertyuiop',
	'asdf',
	'asdfgh',
	'asdfghjkl',
	'zxcvbn',
	'zxcvbnm',
	'qazwsx',
	'letmein',
	'welcome',
	'admin',
	'administrator',
	'login',
	'iloveyou',
	'monkey',
	'dragon',
	'master',
	'shadow',
	'superman',
	'batman',
	'football',
	'baseball',
	'basketball',
	'soccer',
	'hockey',
	'sunshine',
	'princess',
	'flower',
	'computer',
	'internet',
	'samsung',
	'google',
	'facebook',
	'starwars',
	'pokemon',
	'minecraft',
	'trustno',
	'whatever',
	'freedom',
	'ninja',
	'secret',
	'money',
	'hello',
	'summer',
	'winter',
	'autumn',
	'spring',
	'iloveu',
	'abc',
	'abcd',
	'abcde',
	'abcdef',
	'test',
	'testing',
	'guest',
	'user',
	'changeme',
	'default',
	'root',
	'oracle',
	'cookie',
	'pepper',
	'ginger',
	'peanut',
	'cheese',
	'orange',
	'purple',
	'yellow',
	'silver',
	'golden',
	'diamond',
	'michael',
	'jennifer',
	'jordan',
	'harley',
	'ranger',
	'hunter',
	'buster',
	'charlie',
	'andrew',
	'thomas',
	'robert',
	'daniel',
	'jessica',
	'michelle',
	'qwertyui',
	'crubbucks'
]);

const LEET: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'8': 'b',
	'@': 'a',
	'$': 's'
};

function leetFold(s: string): string {
	let out = '';
	for (const ch of s) out += LEET[ch] ?? ch;
	return out;
}

/** If `s` is a single chunk repeated (e.g. "abcabc"), return the chunk. */
function collapseRepeat(s: string): string {
	for (let len = 1; len <= s.length >> 1; len++) {
		if (s.length % len !== 0) continue;
		if (s.slice(0, len).repeat(s.length / len) === s) return s.slice(0, len);
	}
	return s;
}

/** Reduce a password to its alphabetic "core" word for denylist comparison. */
function coreWord(lowered: string): string {
	// Trim leading/trailing runs of non-letters (decorative digits/symbols like
	// "@", "1234!"), then undo internal leetspeak and drop any leftover non-letters.
	const trimmed = lowered.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
	const folded = leetFold(trimmed).replace(/[^a-z]/g, '');
	return collapseRepeat(folded);
}

/**
 * True if the password is too common / guessable to allow. Input is compared
 * case-insensitively after NFKC normalization.
 */
export function isCommonPassword(password: string): boolean {
	if (typeof password !== 'string' || password.length === 0) return false;
	const lowered = password.normalize('NFKC').toLowerCase();
	if (COMMON_PASSWORDS.has(lowered)) return true;
	const core = coreWord(lowered);
	if (core.length >= 3 && COMMON_BASES.has(core)) return true;
	return false;
}
