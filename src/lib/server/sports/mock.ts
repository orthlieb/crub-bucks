import type { FeedAdapter, FeedEvent, FeedEventStatus } from './types';
import { deriveWinner } from './types';

/**
 * Mock sports feed — synthetic multi-sport fixtures (World Cup soccer + MLB).
 *
 * ⚠️ THE SCORES AND OUTCOMES HERE ARE INVENTED for offline development and
 * tests. They are NOT real results. The team names are real; the matchups,
 * kickoff times, and scores are illustrative only.
 *
 * This adapter exists so the feature runs end-to-end with zero network access
 * (the dev sandbox's egress allowlist blocks real sports APIs). Select it with
 * `SPORTS_FEED=mock` (the default). Point at the {@link espnAdapter} once the
 * provider host is allowlisted in the deployment to get live data through the
 * exact same {@link FeedAdapter} contract.
 */

const PROVIDER = 'mock';
const HOUR = 60 * 60 * 1000;

type SeedTeam = { id: string; name: string; abbr: string };

const TEAMS: Record<string, SeedTeam> = {
	// Soccer — World Cup nations
	ARG: { id: 'arg', name: 'Argentina', abbr: 'ARG' },
	FRA: { id: 'fra', name: 'France', abbr: 'FRA' },
	BRA: { id: 'bra', name: 'Brazil', abbr: 'BRA' },
	ESP: { id: 'esp', name: 'Spain', abbr: 'ESP' },
	ENG: { id: 'eng', name: 'England', abbr: 'ENG' },
	USA: { id: 'usa', name: 'United States', abbr: 'USA' },
	MEX: { id: 'mex', name: 'Mexico', abbr: 'MEX' },
	CAN: { id: 'can', name: 'Canada', abbr: 'CAN' },
	// Baseball — MLB clubs
	NYY: { id: 'nyy', name: 'New York Yankees', abbr: 'NYY' },
	BOS: { id: 'bos', name: 'Boston Red Sox', abbr: 'BOS' },
	LAD: { id: 'lad', name: 'Los Angeles Dodgers', abbr: 'LAD' },
	CHC: { id: 'chc', name: 'Chicago Cubs', abbr: 'CHC' },
	// American football — NFL clubs
	KC: { id: 'kc', name: 'Kansas City Chiefs', abbr: 'KC' },
	BUF: { id: 'buf', name: 'Buffalo Bills', abbr: 'BUF' },
	// Canadian football — CFL clubs
	TOR_CFL: { id: 'tor-cfl', name: 'Toronto Argonauts', abbr: 'TOR' },
	BC: { id: 'bc', name: 'BC Lions', abbr: 'BC' },
	// Basketball — NBA clubs
	LAL: { id: 'lal', name: 'Los Angeles Lakers', abbr: 'LAL' },
	GSW: { id: 'gsw', name: 'Golden State Warriors', abbr: 'GSW' },
	// Hockey — NHL clubs
	COL: { id: 'col', name: 'Colorado Avalanche', abbr: 'COL' },
	TBL: { id: 'tbl', name: 'Tampa Bay Lightning', abbr: 'TBL' },
	// Tennis — singles players
	DJO: { id: 'djo', name: 'Novak Djokovic', abbr: 'DJO' },
	ALC: { id: 'alc', name: 'Carlos Alcaraz', abbr: 'ALC' },
	SIN: { id: 'sin', name: 'Jannik Sinner', abbr: 'SIN' },
	SWI: { id: 'swi', name: 'Iga Swiatek', abbr: 'SWI' },
	// Club soccer — Premier League
	MCI: { id: 'mci', name: 'Manchester City', abbr: 'MCI' },
	ARS: { id: 'ars', name: 'Arsenal', abbr: 'ARS' },
	// Club soccer — Champions League
	RMA: { id: 'rma', name: 'Real Madrid', abbr: 'RMA' },
	BAY: { id: 'bay', name: 'Bayern Munich', abbr: 'BAY' },
	// Club soccer — MLS
	MIA: { id: 'mia', name: 'Inter Miami', abbr: 'MIA' },
	LAF: { id: 'laf', name: 'LAFC', abbr: 'LAF' },
	// College football
	UGA: { id: 'uga', name: 'Georgia Bulldogs', abbr: 'UGA' },
	OSU: { id: 'osu', name: 'Ohio State Buckeyes', abbr: 'OSU' },
	// Men's college basketball
	DUKE: { id: 'duke', name: 'Duke Blue Devils', abbr: 'DUKE' },
	KU: { id: 'ku', name: 'Kansas Jayhawks', abbr: 'KU' },
	// WNBA
	LV: { id: 'lv', name: 'Las Vegas Aces', abbr: 'LV' },
	NYL: { id: 'nyl', name: 'New York Liberty', abbr: 'NY' },
	// MMA — UFC fighters
	JON: { id: 'jon', name: 'Jon Jones', abbr: 'JON' },
	ASP: { id: 'asp', name: 'Tom Aspinall', abbr: 'ASP' },
	MAK: { id: 'mak', name: 'Islam Makhachev', abbr: 'MAK' },
	TOP: { id: 'top', name: 'Ilia Topuria', abbr: 'TOP' }
};

type Seed = {
	eventId: string;
	sport: string;
	league: string;
	home: SeedTeam;
	away: SeedTeam;
	/** Hours from "now" — negative = already played, positive = upcoming. */
	offsetHours: number;
	status: FeedEventStatus;
	homeScore: number | null;
	awayScore: number | null;
};

const WC = { sport: 'soccer', league: 'FIFA World Cup' };
const MLB = { sport: 'baseball', league: 'MLB' };
const NFL = { sport: 'football', league: 'NFL' };
const CFL = { sport: 'cfl', league: 'CFL' };
const NBA = { sport: 'basketball', league: 'NBA' };
const NHL = { sport: 'hockey', league: 'NHL' };
const ATP = { sport: 'tennis', league: 'ATP' };
const WTA = { sport: 'tennis', league: 'WTA' };
const EPL = { sport: 'soccer', league: 'Premier League' };
const UCL = { sport: 'soccer', league: 'Champions League' };
const MLS = { sport: 'soccer', league: 'MLS' };
const NCAAF = { sport: 'football', league: 'College Football' };
const NCAAB = { sport: 'basketball', league: "Men's College Basketball" };
const WNBA = { sport: 'basketball', league: 'WNBA' };
const UFC = { sport: 'mma', league: 'UFC' };

// Synthetic schedule centered on "now": finished games, one live, several
// upcoming, plus a postponed one so the void/refund path is exercisable —
// across two sports so the filter has something to do.
const SEEDS: Seed[] = [
	{
		...WC,
		eventId: 'wc2026-001',
		home: TEAMS.ARG,
		away: TEAMS.MEX,
		offsetHours: -27,
		status: 'final',
		homeScore: 2,
		awayScore: 0
	},
	{
		...WC,
		eventId: 'wc2026-002',
		home: TEAMS.FRA,
		away: TEAMS.CAN,
		offsetHours: -3,
		status: 'final',
		homeScore: 1,
		awayScore: 1
	},
	{
		...WC,
		eventId: 'wc2026-003',
		home: TEAMS.BRA,
		away: TEAMS.USA,
		offsetHours: 0,
		status: 'in_progress',
		homeScore: 0,
		awayScore: 1
	},
	{
		...WC,
		eventId: 'wc2026-004',
		home: TEAMS.ESP,
		away: TEAMS.ENG,
		offsetHours: 26,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...WC,
		eventId: 'wc2026-006',
		home: TEAMS.MEX,
		away: TEAMS.CAN,
		offsetHours: 74,
		status: 'postponed',
		homeScore: null,
		awayScore: null
	},
	{
		...MLB,
		eventId: 'mlb-001',
		home: TEAMS.NYY,
		away: TEAMS.BOS,
		offsetHours: -2,
		status: 'final',
		homeScore: 5,
		awayScore: 3
	},
	{
		...MLB,
		eventId: 'mlb-002',
		home: TEAMS.LAD,
		away: TEAMS.CHC,
		offsetHours: 1,
		status: 'in_progress',
		homeScore: 2,
		awayScore: 2
	},
	{
		...MLB,
		eventId: 'mlb-003',
		home: TEAMS.CHC,
		away: TEAMS.NYY,
		offsetHours: 28,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...NFL,
		eventId: 'nfl-001',
		home: TEAMS.KC,
		away: TEAMS.BUF,
		offsetHours: -20,
		status: 'final',
		homeScore: 27,
		awayScore: 24
	},
	{
		...NFL,
		eventId: 'nfl-002',
		home: TEAMS.BUF,
		away: TEAMS.KC,
		offsetHours: 30,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...CFL,
		eventId: 'cfl-001',
		home: TEAMS.BC,
		away: TEAMS.TOR_CFL,
		offsetHours: -5,
		status: 'final',
		homeScore: 21,
		awayScore: 17
	},
	{
		...CFL,
		eventId: 'cfl-002',
		home: TEAMS.TOR_CFL,
		away: TEAMS.BC,
		offsetHours: 6,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...NBA,
		eventId: 'nba-001',
		home: TEAMS.LAL,
		away: TEAMS.GSW,
		offsetHours: 2,
		status: 'in_progress',
		homeScore: 58,
		awayScore: 61
	},
	{
		...NBA,
		eventId: 'nba-002',
		home: TEAMS.GSW,
		away: TEAMS.LAL,
		offsetHours: 28,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...NHL,
		eventId: 'nhl-001',
		home: TEAMS.COL,
		away: TEAMS.TBL,
		offsetHours: -1,
		status: 'final',
		homeScore: 4,
		awayScore: 2
	},
	{
		...NHL,
		eventId: 'nhl-002',
		home: TEAMS.COL,
		away: TEAMS.TBL,
		offsetHours: 52,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...ATP,
		eventId: 'atp-001',
		home: TEAMS.ALC,
		away: TEAMS.DJO,
		offsetHours: -4,
		status: 'final',
		homeScore: 2,
		awayScore: 1
	},
	{
		...ATP,
		eventId: 'atp-002',
		home: TEAMS.SIN,
		away: TEAMS.ALC,
		offsetHours: 18,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...WTA,
		eventId: 'wta-001',
		home: TEAMS.SWI,
		away: TEAMS.SIN,
		offsetHours: 3,
		status: 'in_progress',
		homeScore: 1,
		awayScore: 0
	},
	{
		...EPL,
		eventId: 'epl-001',
		home: TEAMS.MCI,
		away: TEAMS.ARS,
		offsetHours: -6,
		status: 'final',
		homeScore: 2,
		awayScore: 1
	},
	{
		...EPL,
		eventId: 'epl-002',
		home: TEAMS.ARS,
		away: TEAMS.MCI,
		offsetHours: 22,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...UCL,
		eventId: 'ucl-001',
		home: TEAMS.RMA,
		away: TEAMS.BAY,
		offsetHours: 30,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...MLS,
		eventId: 'mls-001',
		home: TEAMS.MIA,
		away: TEAMS.LAF,
		offsetHours: 4,
		status: 'in_progress',
		homeScore: 1,
		awayScore: 1
	},
	{
		...NCAAF,
		eventId: 'ncaaf-001',
		home: TEAMS.UGA,
		away: TEAMS.OSU,
		offsetHours: -8,
		status: 'final',
		homeScore: 31,
		awayScore: 28
	},
	{
		...NCAAF,
		eventId: 'ncaaf-002',
		home: TEAMS.OSU,
		away: TEAMS.UGA,
		offsetHours: 48,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...NCAAB,
		eventId: 'ncaab-001',
		home: TEAMS.DUKE,
		away: TEAMS.KU,
		offsetHours: 20,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		...WNBA,
		eventId: 'wnba-001',
		home: TEAMS.LV,
		away: TEAMS.NYL,
		offsetHours: -3,
		status: 'final',
		homeScore: 88,
		awayScore: 81
	},
	{
		...WNBA,
		eventId: 'wnba-002',
		home: TEAMS.NYL,
		away: TEAMS.LV,
		offsetHours: 26,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	// Real ESPN MMA reports the winner via a per-competitor flag with no numeric
	// score; the mock has only score-derived winners, so we use 1–0 to mark the
	// victor (the espn adapter reads the real flag).
	{
		...UFC,
		eventId: 'ufc-001',
		home: TEAMS.JON,
		away: TEAMS.ASP,
		offsetHours: -10,
		status: 'final',
		homeScore: 1,
		awayScore: 0
	},
	{
		...UFC,
		eventId: 'ufc-002',
		home: TEAMS.MAK,
		away: TEAMS.TOP,
		offsetHours: 40,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	}
];

function toEvent(seed: Seed, nowMs: number): FeedEvent {
	return {
		provider: PROVIDER,
		eventId: seed.eventId,
		sport: seed.sport,
		league: seed.league,
		// Synthetic fixtures have no real logo URLs; the UI falls back to the
		// team abbreviation / league name text.
		leagueLogo: null,
		startTime: new Date(nowMs + seed.offsetHours * HOUR).toISOString(),
		status: seed.status,
		home: { ...seed.home, logo: null },
		away: { ...seed.away, logo: null },
		homeScore: seed.homeScore,
		awayScore: seed.awayScore,
		winner: deriveWinner(seed.status, seed.homeScore, seed.awayScore)
	};
}

/** Build the full synthetic schedule relative to a reference time (default now). */
export function mockEvents(nowMs: number = Date.now()): FeedEvent[] {
	return SEEDS.map((s) => toEvent(s, nowMs));
}

export const mockAdapter: FeedAdapter = {
	provider: PROVIDER,
	async listUpcoming() {
		return mockEvents();
	},
	async getEvent(eventId: string) {
		return mockEvents().find((e) => e.eventId === eventId) ?? null;
	}
};
