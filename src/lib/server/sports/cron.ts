import { building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { settleDueMarkets } from './markets';
import { refreshLeaderboardMedals } from '../ledger';

/**
 * In-process auto-resolution.
 *
 * A single interval in the Node server periodically settles sports markets
 * whose games have finished (see settleDueMarkets). PM2 runs one instance in
 * fork mode, so exactly one timer exists; an in-JS `running` guard stops ticks
 * from overlapping, and resolveMarket's row lock + status guard make settlement
 * safe even if that ever changes.
 *
 * Off by default — set ENABLE_CRON=true in production to turn it on (so dev,
 * tests, and prerender/build never run it). Cadence via SETTLE_INTERVAL_MS.
 */

let started = false;

export function startSettleCron(): void {
	if (started || building) return;
	if (env.ENABLE_CRON !== 'true') return;
	started = true;

	const intervalMs = Number(env.SETTLE_INTERVAL_MS) || 5 * 60 * 1000; // default 5 min
	let running = false;

	const tick = async () => {
		if (running) return; // never overlap a still-running pass
		running = true;
		try {
			const s = await settleDueMarkets();
			if (s.resolved || s.voided || s.errors) {
				console.log(
					`[settle-cron] resolved=${s.resolved} voided=${s.voided} skipped=${s.skipped} errors=${s.errors}`
				);
			}
			// Recompute leaderboard medals and alert on any change in gold/silver/
			// bronze (balances also move via bets/payments between ticks).
			await refreshLeaderboardMedals();
		} catch (err) {
			console.error('[settle-cron] pass failed', err);
		} finally {
			running = false;
		}
	};

	// A short delay after boot lets the server finish starting; unref() so the
	// timer never keeps the process alive on its own.
	setTimeout(tick, 15_000).unref?.();
	setInterval(tick, intervalMs).unref?.();
}
