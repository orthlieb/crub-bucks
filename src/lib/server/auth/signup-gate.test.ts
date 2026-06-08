import { describe, it, expect } from 'vitest';
import {
	DEFAULT_DAILY_FULL_MESSAGE,
	DEFAULT_REGISTRATION_LOCK_MESSAGE,
	evaluateSignupGate
} from './signup-gate';

/**
 * Tiny factory so each test reads as "config with these overrides," not as
 * 4 properties in 4 lines. Keeps the precedence cases especially legible.
 */
const cfg = (overrides: Partial<Parameters<typeof evaluateSignupGate>[0]> = {}) => ({
	registrationLock: false,
	registrationLockMessage: null,
	registrationDailyLimit: null,
	registrationDailyLimitMessage: null,
	...overrides
});

describe('evaluateSignupGate', () => {
	describe('allow path', () => {
		it('allows when nothing is configured', () => {
			expect(evaluateSignupGate(cfg(), 0)).toEqual({ allow: true });
		});

		it('allows when daily limit is unset, regardless of count', () => {
			// e.g. lock off, no cap, and somehow 9999 events already today
			// (impossible in practice but the gate should not care).
			expect(evaluateSignupGate(cfg(), 9999)).toEqual({ allow: true });
		});

		it('allows when daily limit is set and count is under the cap', () => {
			expect(evaluateSignupGate(cfg({ registrationDailyLimit: 10 }), 5)).toEqual({
				allow: true
			});
		});

		it('allows on the boundary one below the cap', () => {
			expect(evaluateSignupGate(cfg({ registrationDailyLimit: 10 }), 9)).toEqual({
				allow: true
			});
		});
	});

	describe('daily-limit gate', () => {
		it('blocks with reason "full_today" when count equals the cap', () => {
			const r = evaluateSignupGate(cfg({ registrationDailyLimit: 10 }), 10);
			expect(r).toEqual({
				allow: false,
				reason: 'full_today',
				message: DEFAULT_DAILY_FULL_MESSAGE
			});
		});

		it('blocks when count exceeds the cap (admin tightened mid-day)', () => {
			const r = evaluateSignupGate(cfg({ registrationDailyLimit: 5 }), 8);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.reason).toBe('full_today');
		});

		it('blocks when cap is 0 — a quota-shaped lock', () => {
			const r = evaluateSignupGate(cfg({ registrationDailyLimit: 0 }), 0);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.reason).toBe('full_today');
		});

		it('uses the custom daily-full message when set', () => {
			const r = evaluateSignupGate(
				cfg({
					registrationDailyLimit: 5,
					registrationDailyLimitMessage: 'Rolling out in waves — check back tomorrow.'
				}),
				5
			);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.message).toBe('Rolling out in waves — check back tomorrow.');
		});

		it('falls back to the default message when the custom one is empty string', () => {
			// Treat empty string as "use default" — admin clearing the field.
			const r = evaluateSignupGate(
				cfg({ registrationDailyLimit: 5, registrationDailyLimitMessage: '' }),
				5
			);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.message).toBe(DEFAULT_DAILY_FULL_MESSAGE);
		});
	});

	describe('manual lock gate', () => {
		it('blocks with reason "locked" when registration is manually locked', () => {
			expect(evaluateSignupGate(cfg({ registrationLock: true }), 0)).toEqual({
				allow: false,
				reason: 'locked',
				message: DEFAULT_REGISTRATION_LOCK_MESSAGE
			});
		});

		it('uses the custom lock message when set', () => {
			const r = evaluateSignupGate(
				cfg({
					registrationLock: true,
					registrationLockMessage: 'Closed for the holidays.'
				}),
				0
			);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.message).toBe('Closed for the holidays.');
		});

		it('blocks regardless of today’s count', () => {
			const r = evaluateSignupGate(cfg({ registrationLock: true }), 999);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.reason).toBe('locked');
		});
	});

	describe('precedence: registration lock overrides daily limit', () => {
		it('returns "locked" — not "full_today" — when both gates would block', () => {
			const r = evaluateSignupGate(
				cfg({
					registrationLock: true,
					registrationDailyLimit: 5
				}),
				10 // cap is also blown
			);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.reason).toBe('locked');
		});

		it('shows the lock message, not the daily-limit message, when both have custom text', () => {
			const r = evaluateSignupGate(
				cfg({
					registrationLock: true,
					registrationLockMessage: 'LOCK MESSAGE',
					registrationDailyLimit: 5,
					registrationDailyLimitMessage: 'LIMIT MESSAGE'
				}),
				10
			);
			expect(r.allow).toBe(false);
			if (!r.allow) {
				expect(r.message).toBe('LOCK MESSAGE');
				expect(r.message).not.toBe('LIMIT MESSAGE');
			}
		});

		it('locks even when the daily cap has not been reached yet', () => {
			// Admin manually locked, but only 1 signup today out of a cap of 10.
			// The lock is still in force — that's the whole point of a manual lock.
			const r = evaluateSignupGate(cfg({ registrationLock: true, registrationDailyLimit: 10 }), 1);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.reason).toBe('locked');
		});

		it('locks when no daily limit is set at all', () => {
			// Regression check: lock must work in isolation, not depend on
			// the daily-limit configuration being present.
			const r = evaluateSignupGate(cfg({ registrationLock: true }), 0);
			expect(r.allow).toBe(false);
			if (!r.allow) expect(r.reason).toBe('locked');
		});

		it('drops back to the daily-cap gate the moment the lock is lifted', () => {
			// Start: locked AND over cap → locked.
			const locked = evaluateSignupGate(
				cfg({ registrationLock: true, registrationDailyLimit: 5 }),
				10
			);
			expect(locked.allow).toBe(false);
			if (!locked.allow) expect(locked.reason).toBe('locked');

			// Admin flips the lock off; cap still blown → full_today now.
			const unlocked = evaluateSignupGate(
				cfg({ registrationLock: false, registrationDailyLimit: 5 }),
				10
			);
			expect(unlocked.allow).toBe(false);
			if (!unlocked.allow) expect(unlocked.reason).toBe('full_today');
		});
	});

	describe('midnight reset semantics (behavioral note)', () => {
		// The gate itself is stateless — the "reset at midnight" behavior is
		// emergent: callers pass `countToday`, and the underlying SQL counts
		// `created_at >= midnight today`. Once a new day starts, the same
		// config + a freshly-derived count of 0 returns allow:true.
		// These tests pin that the gate cooperates with that reset.

		it('flips back to allow when a new day arrives (count resets to 0)', () => {
			const config = cfg({ registrationDailyLimit: 5 });
			// End of day: full.
			expect(evaluateSignupGate(config, 5).allow).toBe(false);
			// New day: count is 0 again → allowed.
			expect(evaluateSignupGate(config, 0)).toEqual({ allow: true });
		});
	});
});
