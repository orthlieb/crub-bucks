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
 * Scoreboard endpoint shape:
 *   https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard
 */

const BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const PROVIDER = 'espn';
const TIMEOUT_MS = 6000;

/**
 * The scoreboards we pull. `path` is ESPN's `{sport}/{league}` slug, `sport`
 * tags every event for the sport filter, and `league` is a display fallback if
 * a payload omits its own name. Add a row to surface another competition — the
 * adapter fetches them all in parallel and each fails safe on its own.
 */
export const COMPETITIONS: {
	sport: string;
	path: string;
	league: string;
	/** 'tennis' uses the athlete/per-match parser; default is the team parser. */
	kind?: 'team' | 'tennis';
}[] = [
	{ sport: 'soccer', path: 'soccer/fifa.world', league: 'FIFA World Cup' },
	{ sport: 'baseball', path: 'baseball/mlb', league: 'MLB' },
	{ sport: 'football', path: 'football/nfl', league: 'NFL' },
	// ESPN serves Canadian football under the same `football` sport path; we tag
	// it 'cfl' so it filters separately from the NFL.
	{ sport: 'cfl', path: 'football/cfl', league: 'CFL' },
	{ sport: 'basketball', path: 'basketball/nba', league: 'NBA' },
	{ sport: 'hockey', path: 'hockey/nhl', league: 'NHL' },
	// Tennis singles — player vs player (head-to-head fits the two-sided market).
	{ sport: 'tennis', path: 'tennis/atp', league: 'ATP', kind: 'tennis' },
	{ sport: 'tennis', path: 'tennis/wta', league: 'WTA', kind: 'tennis' }
];

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
/** First usable logo href from an ESPN `logos` array, preferring a non-dark
 *  variant so it reads on a light background. Returns null if none. */
function firstLogo(logos: any): string | null {
	if (!Array.isArray(logos)) return null;
	const light = logos.find((l: any) => !String(l?.rel ?? '').includes('dark'));
	const href = (light ?? logos[0])?.href;
	return typeof href === 'string' && href ? href : null;
}

/** A team's logo: ESPN gives a single `team.logo` on scoreboards, sometimes a
 *  `team.logos[]` array instead. Try both. */
function teamLogo(team: any): string | null {
	if (typeof team?.logo === 'string' && team.logo) return team.logo;
	return firstLogo(team?.logos);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Parse one ESPN scoreboard payload into normalized events. Pure — no network —
 * so the messy shape-handling is fully unit-testable from a captured fixture.
 * Unparseable events are skipped rather than throwing the whole batch away.
 */
export function parseEspnScoreboard(json: any, sport: string, fallbackLeague = ''): FeedEvent[] {
	const events = Array.isArray(json?.events) ? json.events : [];
	const league: string = json?.leagues?.[0]?.name ?? fallbackLeague;
	const leagueLogo = firstLogo(json?.leagues?.[0]?.logos);

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
			sport,
			league,
			leagueLogo,
			startTime: String(ev.date ?? comp.date ?? ''),
			status,
			home: {
				id: String(home.team?.id ?? ''),
				name: String(home.team?.displayName ?? home.team?.name ?? ''),
				abbr: String(home.team?.abbreviation ?? ''),
				logo: teamLogo(home.team)
			},
			away: {
				id: String(away.team?.id ?? ''),
				name: String(away.team?.displayName ?? away.team?.name ?? ''),
				abbr: String(away.team?.abbreviation ?? ''),
				logo: teamLogo(away.team)
			},
			homeScore,
			awayScore,
			winner: deriveWinner(status, homeScore, awayScore)
		});
	}
	return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Normalize an ESPN tennis competitor (an `athlete`, occasionally a `team`)
 *  into our team shape — name, short code, and a headshot/flag logo. */
function athleteSide(competitor: any): FeedEvent['home'] {
	const a = competitor?.athlete ?? competitor?.team ?? {};
	const name = String(a.displayName ?? a.fullName ?? a.shortName ?? a.name ?? '');
	const abbr = String(a.abbreviation ?? a.shortName ?? name.split(' ').pop() ?? '');
	const headshot = typeof a.headshot === 'object' ? a.headshot?.href : a.headshot;
	const logo = headshot || a.flag?.href || teamLogo(a) || null;
	return { id: String(a.id ?? ''), name, abbr, logo };
}

/**
 * Parse an ESPN tennis scoreboard. Unlike team sports, each event is a
 * tournament whose `competitions` are the individual matches; competitors are
 * athletes, and the winner comes from the per-competitor `winner` flag (no
 * draws). Singles only — sides with a single athlete each.
 */
export function parseEspnTennis(json: any, sport: string, fallbackLeague = ''): FeedEvent[] {
	const events = Array.isArray(json?.events) ? json.events : [];
	const league: string = json?.leagues?.[0]?.name ?? fallbackLeague;
	const leagueLogo = firstLogo(json?.leagues?.[0]?.logos);

	const out: FeedEvent[] = [];
	for (const ev of events) {
		const comps = Array.isArray(ev?.competitions) ? ev.competitions : [];
		for (const comp of comps) {
			const competitors = comp?.competitors;
			if (!Array.isArray(competitors) || competitors.length < 2) continue;
			const home = competitors.find((c: any) => c?.homeAway === 'home') ?? competitors[0];
			const away = competitors.find((c: any) => c?.homeAway === 'away') ?? competitors[1];
			if (!home || !away || home === away) continue;

			const statusType = (comp.status ?? ev.status)?.type ?? {};
			const status = normalizeEspnStatus(statusType.name, statusType.state, statusType.completed);
			const homeScore = num(home.score);
			const awayScore = num(away.score);
			let winner: FeedEvent['winner'] = null;
			if (status === 'final') {
				if (home.winner === true) winner = 'home';
				else if (away.winner === true) winner = 'away';
				else winner = deriveWinner(status, homeScore, awayScore);
			}

			out.push({
				provider: PROVIDER,
				eventId: String(comp.id ?? ev.id ?? ''),
				sport,
				league,
				leagueLogo,
				startTime: String(comp.date ?? ev.date ?? ''),
				status,
				home: athleteSide(home),
				away: athleteSide(away),
				homeScore,
				awayScore,
				winner
			});
		}
	}
	return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function fetchCompetition(c: (typeof COMPETITIONS)[number]): Promise<FeedEvent[]> {
	try {
		const res = await fetch(`${BASE}/${c.path}/scoreboard`, {
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return []; // fail safe
		const json = await res.json();
		return c.kind === 'tennis'
			? parseEspnTennis(json, c.sport, c.league)
			: parseEspnScoreboard(json, c.sport, c.league);
	} catch {
		return []; // network error / timeout / bad JSON — fail safe
	}
}

/** Fetch every configured scoreboard in parallel; one failing competition
 *  yields [] for itself without taking down the others. */
async function fetchAll(): Promise<FeedEvent[]> {
	const batches = await Promise.all(COMPETITIONS.map(fetchCompetition));
	return batches.flat();
}

export const espnAdapter: FeedAdapter = {
	provider: PROVIDER,
	async listUpcoming() {
		return fetchAll();
	},
	async getEvent(eventId: string) {
		const all = await fetchAll();
		return all.find((e) => e.eventId === eventId) ?? null;
	}
};
