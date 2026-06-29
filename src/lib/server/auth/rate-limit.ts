/**
 * Minimal in-memory per-key rate limiter (fixed window). In-process only — fine
 * for the single PM2-supervised Node process; structured so it can be swapped for
 * a Postgres/Redis-backed counter if the app ever scales out. Not the only
 * defense (login also has per-account lockout) — this throttles blind password
 * guessing from a single IP before it ever touches the DB.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export interface RateLimitResult {
	ok: boolean;
	/** Milliseconds until the window resets (0 when not limited). */
	retryAfterMs: number;
}

/** Record a hit against `key` and report whether it's within `limit` per `windowMs`. */
export function rateLimit(
	key: string,
	limit: number,
	windowMs: number,
	now: number = Date.now()
): RateLimitResult {
	const bucket = buckets.get(key);
	if (!bucket || now >= bucket.resetAt) {
		buckets.set(key, { count: 1, resetAt: now + windowMs });
		return { ok: true, retryAfterMs: 0 };
	}
	bucket.count += 1;
	if (bucket.count > limit) return { ok: false, retryAfterMs: bucket.resetAt - now };
	return { ok: true, retryAfterMs: 0 };
}

/** Drop expired buckets so the map can't grow without bound. */
export function pruneRateLimits(now: number = Date.now()): void {
	for (const [key, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(key);
}

/** Test-only: clear all counters. */
export function __resetRateLimits(): void {
	buckets.clear();
}
