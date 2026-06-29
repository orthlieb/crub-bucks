import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, __resetRateLimits } from './rate-limit';

beforeEach(() => __resetRateLimits());

describe('rateLimit', () => {
	it('allows up to the limit, then blocks within the window', () => {
		const key = 'login:1.2.3.4';
		for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 1000, 0).ok).toBe(true);
		const blocked = rateLimit(key, 5, 1000, 0);
		expect(blocked.ok).toBe(false);
		expect(blocked.retryAfterMs).toBe(1000);
	});

	it('resets once the window elapses', () => {
		const key = 'login:5.6.7.8';
		for (let i = 0; i < 5; i++) rateLimit(key, 5, 1000, 0);
		expect(rateLimit(key, 5, 1000, 0).ok).toBe(false);
		expect(rateLimit(key, 5, 1000, 1000).ok).toBe(true); // new window
	});

	it('isolates keys (per-IP)', () => {
		expect(rateLimit('a', 1, 1000, 0).ok).toBe(true);
		expect(rateLimit('a', 1, 1000, 0).ok).toBe(false);
		expect(rateLimit('b', 1, 1000, 0).ok).toBe(true);
	});
});
