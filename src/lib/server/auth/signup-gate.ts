/**
 * Pure decision logic for whether a new-account attempt is allowed.
 *
 * Two gates can refuse a signup:
 *
 *   1. Registration LOCK — a manual admin switch. Hard stop. The lock has
 *      no time component; it stays on until an admin flips it off.
 *
 *   2. Daily SIGNUP LIMIT — a soft cap on successful registrations per
 *      calendar day (server local time). Used for "easing in" launches.
 *      Once today's count hits the cap, further attempts are refused
 *      until midnight; at midnight the count rolls back to zero on its
 *      own because we derive it from `created_at >= midnight today`,
 *      not from a stored counter.
 *
 * **Lock overrides the daily limit.** When both would block — e.g. the
 * admin has manually locked registration *and* the cap is also reached
 * — the response is "locked", with the lock message. The lock is the
 * stronger / intentional gate; the daily cap is a guard rail. Tests
 * pin this ordering.
 *
 * Extracted as a pure function so it's unit-testable without a DB. The
 * register action wires it up with values from getSystemConfig() and
 * countRegistrationsToday().
 */

import type { SystemConfig } from './system-config';

export const DEFAULT_REGISTRATION_LOCK_MESSAGE =
	'Registration is currently closed. Please try again later.';

export const DEFAULT_DAILY_FULL_MESSAGE =
	"Today's signups are full. Registration reopens at midnight.";

export type SignupGate =
	| { allow: true }
	| { allow: false; reason: 'locked' | 'full_today'; message: string };

/** The subset of SystemConfig this function actually reads. */
type GateConfig = Pick<
	SystemConfig,
	| 'registrationLock'
	| 'registrationLockMessage'
	| 'registrationDailyLimit'
	| 'registrationDailyLimitMessage'
>;

export function evaluateSignupGate(config: GateConfig, countToday: number): SignupGate {
	// (1) Manual lock is the stronger gate. Always checked first.
	if (config.registrationLock) {
		return {
			allow: false,
			reason: 'locked',
			message: config.registrationLockMessage || DEFAULT_REGISTRATION_LOCK_MESSAGE
		};
	}

	// (2) Daily soft cap. A cap of 0 is allowed and refuses every signup
	// today — equivalent to a quota-shaped lock.
	if (
		config.registrationDailyLimit !== null &&
		countToday >= config.registrationDailyLimit
	) {
		return {
			allow: false,
			reason: 'full_today',
			message: config.registrationDailyLimitMessage || DEFAULT_DAILY_FULL_MESSAGE
		};
	}

	return { allow: true };
}
