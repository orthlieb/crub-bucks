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
	/** 'athlete' uses the per-match athlete parser (tennis, MMA); default is the
	 *  team parser. */
	kind?: 'team' | 'athlete';
}[] = [
	{ sport: 'soccer', path: 'soccer/fifa.world', league: 'FIFA World Cup' },
	// Club soccer — all tagged 'soccer' so they share the soccer filter/icon.
	{ sport: 'soccer', path: 'soccer/eng.1', league: 'Premier League' },
	{ sport: 'soccer', path: 'soccer/uefa.champions', league: 'Champions League' },
	{ sport: 'soccer', path: 'soccer/usa.1', league: 'MLS' },
	{ sport: 'baseball', path: 'baseball/mlb', league: 'MLB' },
	{ sport: 'football', path: 'football/nfl', league: 'NFL' },
	// College football rides the same `football` sport tag as the NFL.
	{ sport: 'football', path: 'football/college-football', league: 'College Football' },
	// ESPN serves Canadian football under the same `football` sport path; we tag
	// it 'cfl' so it filters separately from the NFL.
	{ sport: 'cfl', path: 'football/cfl', league: 'CFL' },
	{ sport: 'basketball', path: 'basketball/nba', league: 'NBA' },
	// WNBA + men's college hoops share the 'basketball' tag.
	{ sport: 'basketball', path: 'basketball/wnba', league: 'WNBA' },
	{
		sport: 'basketball',
		path: 'basketball/mens-college-basketball',
		league: "Men's College Basketball"
	},
	{ sport: 'hockey', path: 'hockey/nhl', league: 'NHL' },
	// Tennis singles — player vs player (head-to-head fits the two-sided market).
	{ sport: 'tennis', path: 'tennis/atp', league: 'ATP', kind: 'athlete' },
	{ sport: 'tennis', path: 'tennis/wta', league: 'WTA', kind: 'athlete' },
	// MMA — each card's `competitions` are individual fights (fighter vs fighter),
	// same per-match athlete shape as tennis.
	{ sport: 'mma', path: 'mma/ufc', league: 'UFC', kind: 'athlete' }
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
/** Normalize an ESPN athlete competitor (an `athlete`, occasionally a `team`)
 *  into our team shape — name, short code, and a headshot/country-flag logo.
 *  Tennis athletes carry no `abbreviation`, so we fall back to `shortName`
 *  ("Z. Piros") then the surname. */
function athleteSide(competitor: any): FeedEvent['home'] {
	const a = competitor?.athlete ?? competitor?.team ?? {};
	const name = String(a.displayName ?? a.fullName ?? a.shortName ?? a.name ?? '');
	const abbr = String(a.abbreviation ?? a.shortName ?? name.split(' ').pop() ?? '');
	const headshot = typeof a.headshot === 'object' ? a.headshot?.href : a.headshot;
	const logo = headshot || a.flag?.href || teamLogo(a) || null;
	return { id: String(a.id ?? a.guid ?? ''), name, abbr, logo };
}

/** Every match competition under an event, whether ESPN lists them flat (MMA
 *  cards: `event.competitions[]`) or nested per round/draw (tennis tournaments:
 *  `event.groupings[].competitions[]`). */
function athleteCompetitions(ev: any): any[] {
	const flat = Array.isArray(ev?.competitions) ? ev.competitions : [];
	const grouped = Array.isArray(ev?.groupings)
		? ev.groupings.flatMap((g: any) => (Array.isArray(g?.competitions) ? g.competitions : []))
		: [];
	return [...flat, ...grouped];
}

/** A real, bettable singles matchup: two single athletes (doubles sides carry a
 *  `roster` array instead of one `athlete`), both actually named — an unfilled
 *  bracket slot shows up as an empty name or "TBD". */
function isNamedSingles(
	home: any,
	away: any,
	homeSide: FeedEvent['home'],
	awaySide: FeedEvent['home']
): boolean {
	if (home?.roster || away?.roster) return false; // doubles
	const named = (n: string) => n.trim() !== '' && n.trim().toUpperCase() !== 'TBD';
	return named(homeSide.name) && named(awaySide.name);
}

/**
 * Parse an ESPN per-match athlete scoreboard (tennis tournaments, MMA cards).
 * Unlike team sports, matches live either flat on the event (MMA) or nested
 * under `groupings[]` rounds (tennis); competitors are athletes and the winner
 * comes from the per-competitor `winner` flag (no draws). Singles only — doubles
 * (a `roster` side) and TBD bracket slots are skipped so the list stays bettable.
 */
export function parseEspnAthleteMatches(
	json: any,
	sport: string,
	fallbackLeague = ''
): FeedEvent[] {
	const events = Array.isArray(json?.events) ? json.events : [];
	const league: string = json?.leagues?.[0]?.name ?? fallbackLeague;
	const leagueLogo = firstLogo(json?.leagues?.[0]?.logos);

	const out: FeedEvent[] = [];
	for (const ev of events) {
		for (const comp of athleteCompetitions(ev)) {
			const competitors = comp?.competitors;
			if (!Array.isArray(competitors) || competitors.length < 2) continue;
			const home = competitors.find((c: any) => c?.homeAway === 'home') ?? competitors[0];
			const away = competitors.find((c: any) => c?.homeAway === 'away') ?? competitors[1];
			if (!home || !away || home === away) continue;

			const homeSide = athleteSide(home);
			const awaySide = athleteSide(away);
			if (!isNamedSingles(home, away, homeSide, awaySide)) continue;

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
				startTime: String(comp.date ?? comp.startDate ?? ev.date ?? ''),
				status,
				home: homeSide,
				away: awaySide,
				homeScore,
				awayScore,
				winner
			});
		}
	}
	return out;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** How many days ahead to pull. ESPN scoreboards return only the current day's
 *  slate by default, which leaves day-scheduled tennis draws and the weekly UFC
 *  card (and any sport with no game *today*) invisible on the "Bet on a game"
 *  list. A forward window surfaces the upcoming schedule for every sport.
 *
 *  Team sports run most days, so a short window already fills the list. The
 *  "athlete" sports are episodic — a UFC card can be weeks out and a tennis
 *  tournament only posts a few days at a time — so they look much further ahead
 *  to reach the next event. */
const WINDOW_DAYS = 10;
const ATHLETE_WINDOW_DAYS = 60;
const windowFor = (c: { kind?: 'team' | 'athlete' }) =>
	c.kind === 'athlete' ? ATHLETE_WINDOW_DAYS : WINDOW_DAYS;

/** ESPN's `dates` range param, `YYYYMMDD-YYYYMMDD`, from today through the
 *  window. Endpoints that don't honour a range just return today's slate, so
 *  this only ever adds games — never removes the current behaviour. */
export function forwardWindow(days = WINDOW_DAYS, from: Date = new Date()): string {
	const fmt = (d: Date) =>
		`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
	const end = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
	return `${fmt(from)}-${fmt(end)}`;
}

/** Fetch + parse one scoreboard URL for a competition. Fails safe to []. */
async function fetchScoreboard(
	c: (typeof COMPETITIONS)[number],
	query: string
): Promise<FeedEvent[]> {
	try {
		const res = await fetch(`${BASE}/${c.path}/scoreboard${query}`, {
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (!res.ok) return []; // fail safe
		const json = await res.json();
		return c.kind === 'athlete'
			? parseEspnAthleteMatches(json, c.sport, c.league)
			: parseEspnScoreboard(json, c.sport, c.league);
	} catch {
		return []; // network error / timeout / bad JSON — fail safe
	}
}

/**
 * Pull a competition two ways and union them:
 *  - the **default** scoreboard (no `dates`) returns each league's current/next
 *    slate, so an out-of-window or off-season league still surfaces its next
 *    games (this is what kept e.g. the NFL/EPL visible before the date window);
 *  - the **forward window** (`dates=…`) adds the near-term schedule for
 *    in-season sports (and the day-scheduled tennis / weekly UFC card).
 * Deduped by eventId so the overlap (today's games) isn't listed twice.
 */
async function fetchCompetition(c: (typeof COMPETITIONS)[number]): Promise<FeedEvent[]> {
	const [base, windowed] = await Promise.all([
		fetchScoreboard(c, ''),
		fetchScoreboard(c, `?dates=${forwardWindow(windowFor(c))}`)
	]);
	const byId = new Map<string, FeedEvent>();
	for (const e of [...base, ...windowed]) {
		if (e.eventId && !byId.has(e.eventId)) byId.set(e.eventId, e);
	}
	return [...byId.values()];
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
