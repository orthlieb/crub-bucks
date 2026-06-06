import { createHash } from 'node:crypto';
import { env } from '$env/dynamic/private';

/**
 * HaveIBeenPwned — Pwned Passwords API (k-anonymity model)
 *
 * Checks whether a password has appeared in a known data breach. Only the
 * first 5 characters of the password's SHA-1 hash are sent to HIBP; they
 * return every hash with that prefix and we match the rest locally. The
 * password — and even its full hash — never leaves this server.
 *
 * The range endpoint is keyless and free; `HIBP_API_KEY` is optional and only
 * raises rate limits. We FAIL OPEN: if HIBP is unreachable or errors, we treat
 * the password as not-breached so a third-party outage can't block signups.
 *
 * See: https://haveibeenpwned.com/API/v3#PwnedPasswords
 */

/**
 * Returns how many times a password appears in known breaches, or 0 if it
 * never appears (or if HIBP is unreachable).
 */
export async function getPwnedCount(password: string): Promise<number> {
	const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
	const prefix = sha1.slice(0, 5); // sent to HIBP
	const suffix = sha1.slice(5); // checked locally — never sent

	const headers: Record<string, string> = {
		// Pad the response to a fixed size so on-path observers can't infer the
		// result from the response length.
		'Add-Padding': 'true'
	};
	if (env.HIBP_API_KEY) headers['hibp-api-key'] = env.HIBP_API_KEY;

	try {
		const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
			headers,
			signal: AbortSignal.timeout(4000)
		});
		if (!res.ok) return 0; // fail open

		const text = await res.text();
		// Each line is "SUFFIX:COUNT". Padding rows have count 0 — safe to ignore.
		for (const line of text.split('\n')) {
			const [hashSuffix, countStr] = line.trim().split(':');
			if (hashSuffix === suffix) return parseInt(countStr ?? '0', 10) || 0;
		}
		return 0; // not found
	} catch {
		return 0; // network error / timeout — fail open
	}
}

export class PwnedPasswordError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PwnedPasswordError';
	}
}

/**
 * Throws {@link PwnedPasswordError} if the password appears in a known breach.
 * Call after the synchronous {@link validatePassword} passes, during
 * registration and password reset.
 */
export async function assertPasswordNotPwned(password: string): Promise<void> {
	const count = await getPwnedCount(password);
	if (count > 0) {
		throw new PwnedPasswordError(
			`This password has appeared in ${count.toLocaleString()} known data ` +
				`breach${count === 1 ? '' : 'es'} — please choose a different one.`
		);
	}
}
