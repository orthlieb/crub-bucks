import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { getPwnedCount, assertPasswordNotPwned, PwnedPasswordError } from './hibp';

function sha1Upper(s: string): string {
	return createHash('sha1').update(s).digest('hex').toUpperCase();
}

/** Build a realistic range-API response body whose suffix list includes the
 * given password's hash suffix with the given breach count. */
function rangeBodyFor(password: string, count: number): string {
	const suffix = sha1Upper(password).slice(5);
	return ['00000000000000000000000000000000000:3', `${suffix}:${count}`, 'FFFFFFFF:0'].join('\r\n');
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('getPwnedCount', () => {
	it('returns the breach count when the suffix is present', async () => {
		const pw = 'correct-horse-battery';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(rangeBodyFor(pw, 42), { status: 200 }))
		);
		expect(await getPwnedCount(pw)).toBe(42);
	});

	it('sends only the 5-char hash prefix, never the password', async () => {
		const pw = 'super-secret-passphrase';
		const fetchMock = vi.fn(
			async (_input: string | URL | Request) => new Response('AAAA:1', { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);
		await getPwnedCount(pw);
		const url = String(fetchMock.mock.calls[0]?.[0]);
		expect(url).toBe(`https://api.pwnedpasswords.com/range/${sha1Upper(pw).slice(0, 5)}`);
		expect(url).not.toContain(pw);
		expect(url).not.toContain(sha1Upper(pw).slice(5)); // suffix stays local
	});

	it('returns 0 when the suffix is not in the list', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:9', { status: 200 }))
		);
		expect(await getPwnedCount('a-password-not-in-the-list')).toBe(0);
	});

	it('fails open (returns 0) on a non-OK response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('rate limited', { status: 429 }))
		);
		expect(await getPwnedCount('whatever')).toBe(0);
	});

	it('fails open (returns 0) on a network error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('network down');
			})
		);
		expect(await getPwnedCount('whatever')).toBe(0);
	});
});

describe('assertPasswordNotPwned', () => {
	it('throws PwnedPasswordError for a breached password', async () => {
		const pw = 'breached-password-123';
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(rangeBodyFor(pw, 7), { status: 200 }))
		);
		await expect(assertPasswordNotPwned(pw)).rejects.toBeInstanceOf(PwnedPasswordError);
	});

	it('resolves for a non-breached password', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1', { status: 200 }))
		);
		await expect(assertPasswordNotPwned('a-fresh-unique-passphrase')).resolves.toBeUndefined();
	});
});
