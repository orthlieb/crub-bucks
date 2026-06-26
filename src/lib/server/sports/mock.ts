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
	CHC: { id: 'chc', name: 'Chicago Cubs', abbr: 'CHC' }
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
	}
];

function toEvent(seed: Seed, nowMs: number): FeedEvent {
	return {
		provider: PROVIDER,
		eventId: seed.eventId,
		sport: seed.sport,
		league: seed.league,
		startTime: new Date(nowMs + seed.offsetHours * HOUR).toISOString(),
		status: seed.status,
		home: seed.home,
		away: seed.away,
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
