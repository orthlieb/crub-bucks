import { env } from '$env/dynamic/private';
import type { FeedAdapter } from './types';
import { espnAdapter } from './espn';
import { mockAdapter } from './mock';

/**
 * Sports feed entry point.
 *
 * Pick the provider with the `SPORTS_FEED` env var:
 *   - `mock` (default) — synthetic World Cup fixtures, no network needed.
 *   - `espn`           — live ESPN scoreboard (requires egress allowlisting).
 *
 * Defaulting to `mock` keeps local dev and CI fully offline; flip to `espn` in
 * the deployment once `site.api.espn.com` is in the network policy. Everything
 * downstream depends only on the {@link FeedAdapter} contract, so this is the
 * single place that knows which provider is live.
 */

const ADAPTERS: Record<string, FeedAdapter> = {
	mock: mockAdapter,
	espn: espnAdapter
};

export function getFeed(): FeedAdapter {
	const choice = (env.SPORTS_FEED ?? 'mock').toLowerCase();
	return ADAPTERS[choice] ?? mockAdapter;
}

export type { FeedAdapter, FeedEvent, FeedEventStatus, FeedTeam } from './types';
export { deriveWinner, dedupeEvents } from './types';
