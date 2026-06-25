import type { FeedAdapter, FeedEvent, FeedEventStatus } from './types';
import { deriveWinner } from './types';

/**
 * ESPN sports feed adapter (unofficial, keyless).
 *
 * ESPN exposes a public, no-API-key scoreboard JSON used by their own site. It's
 * undocumented and unsupported — perfect for a prototype, but treat it as
 * best-effort: we FAIL SAFE (return [] / null) on any error so a third-party
 * outage can never break the app. Swap in a paid provider (SportRadar,
 * API-SPORTS) behind the same {@link FeedAdapter} contract for production SLAs.
 *
 * NOTE: outbound egress to `site.api.espn.com` must be allowlisted in the
 * deployment's network policy, or every call here fails closed to empty.
 *
 * Scoreboard endpoint:
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
// Soccer "league" slug for the men's World Cup on ESPN's API.
const COMPETITION = 'soccer/fifa.world';
const PROVIDER = 'espn';
const TIMEOUT_MS = 6000;

/**
 * Map ESPN's status (`type.name` + `state` + `completed`) onto our normalized
 * enum. Pure and exported so it can be unit-tested against the real vocabulary
 * without a network round-trip.
 *
 * ESPN status names seen in the wild: STATUS_SCHEDULED, STATUS_IN_PROGRESS,
 * STATUS_HALFTIME, STATUS_FIRST_HALF, STATUS_FULL_TIME, STATUS_FINAL,
 * STATUS_POSTPONED, STATUS_CANCELED, STATUS_ABANDONED.
 */
export function normalizeEspnStatus(
	typeName: string | undefined,
	state: string | undefined,
	completed: boolean | undefined
): FeedEventStatus {
	const name = (typeName ?? '').toUpperCase();
	if (name.includes('POSTPONED')) return 'postponed';
	// ESPN spells it "CANCELED"; match both and treat abandoned as cancelled too.
	if (name.includes('CANCEL') || name.includes('ABANDON')) return 'cancelled';
	if (completed || name.includes('FINAL') || name.includes('FULL_TIME')) return 'final';
	if (state === 'in') return 'in_progress';
	if (state === 'post') return 'final'; // ended without a more specific name
	return 'scheduled';
}

function num(score: unknown): number | null {
	if (score === null || score === undefined || score === '') return null;
	const n = typeof score === 'number' ? score : parseInt(String(score), 10);
	return Number.isFinite(n) ? n : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Parse one ESPN scoreboard payload into normalized events. Pure — no network —
 * so the messy shape-handling is fully unit-testable from a captured fixture.
 * Unparseable events are skipped rather than throwing the whole batch away.
 */
export function parseEspnScoreboard(json: any): FeedEvent[] {
	const events = Array.isArray(json?.events) ? json.events : [];
	const league: string = json?.leagues?.[0]?.name ?? 'FIFA World Cup';

	const out: FeedEvent[] = [];
	for (const ev of events) {
		const comp = ev?.competitions?.[0];
		const competitors = comp?.competitors;
		if (!comp || !Array.isArray(competitors)) continue;

		const home = competitors.find((c: any) => c?.homeAway === 'home');
		const away = competitors.find((c: any) => c?.homeAway === 'away');
		if (!home || !away) continue;

		const statusType = (comp.status ?? ev.status)?.type ?? {};
		const status = normalizeEspnStatus(statusType.name, statusType.state, statusType.completed);
		const homeScore = num(home.score);
		const awayScore = num(away.score);

		out.push({
			provider: PROVIDER,
			eventId: String(ev.id ?? comp.id ?? ''),
			league,
			startTime: String(ev.date ?? comp.date ?? ''),
			status,
			home: {
				id: String(home.team?.id ?? ''),
				name: String(home.team?.displayName ?? home.team?.name ?? ''),
				abbr: String(home.team?.abbreviation ?? '')
			},
			away: {
				id: String(away.team?.id ?? ''),
				name: String(away.team?.displayName ?? away.team?.name ?? ''),
				abbr: String(away.team?.abbreviation ?? '')
			},
			homeScore,
			awayScore,
			winner: deriveWinner(status, homeScore, awayScore)
		});
	}
	return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function fetchScoreboard(): Promise<FeedEvent[]> {
	try {
		const res = await fetch(`${BASE}/${COMPETITION}/scoreboard`, {
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return []; // fail safe
		return parseEspnScoreboard(await res.json());
	} catch {
		return []; // network error / timeout / bad JSON — fail safe
	}
}

export const espnAdapter: FeedAdapter = {
	provider: PROVIDER,
	async listUpcoming() {
		return fetchScoreboard();
	},
	async getEvent(eventId: string) {
		const all = await fetchScoreboard();
		return all.find((e) => e.eventId === eventId) ?? null;
	}
};
