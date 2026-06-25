import type { FeedAdapter, FeedEvent, FeedEventStatus } from './types';
import { deriveWinner } from './types';

/**
 * Mock sports feed — synthetic FIFA World Cup 2026 fixtures.
 *
 * ⚠️ THE SCORES AND OUTCOMES HERE ARE INVENTED for offline development and
 * tests. They are NOT real match results. The team names are real World Cup
 * nations; the matchups, kickoff times, and scores are illustrative only.
 *
 * This adapter exists so the feature runs end-to-end with zero network access
 * (the dev sandbox's egress allowlist blocks real sports APIs). Select it with
 * `SPORTS_FEED=mock` (the default). Point at the {@link espnAdapter} once the
 * provider host is allowlisted in the deployment to get live data through the
 * exact same {@link FeedAdapter} contract.
 */

const PROVIDER = 'mock';
const LEAGUE = 'FIFA World Cup';
const HOUR = 60 * 60 * 1000;

type SeedTeam = { id: string; name: string; abbr: string };

const TEAMS: Record<string, SeedTeam> = {
	ARG: { id: 'arg', name: 'Argentina', abbr: 'ARG' },
	FRA: { id: 'fra', name: 'France', abbr: 'FRA' },
	BRA: { id: 'bra', name: 'Brazil', abbr: 'BRA' },
	ESP: { id: 'esp', name: 'Spain', abbr: 'ESP' },
	ENG: { id: 'eng', name: 'England', abbr: 'ENG' },
	USA: { id: 'usa', name: 'United States', abbr: 'USA' },
	MEX: { id: 'mex', name: 'Mexico', abbr: 'MEX' },
	CAN: { id: 'can', name: 'Canada', abbr: 'CAN' }
};

type Seed = {
	eventId: string;
	home: SeedTeam;
	away: SeedTeam;
	/** Hours from "now" — negative = already played, positive = upcoming. */
	offsetHours: number;
	status: FeedEventStatus;
	homeScore: number | null;
	awayScore: number | null;
};

// Synthetic schedule centered on "now": two finished games, one live, two
// upcoming, plus a postponed one so the void/refund path is exercisable.
const SEEDS: Seed[] = [
	{
		eventId: 'wc2026-001',
		home: TEAMS.ARG,
		away: TEAMS.MEX,
		offsetHours: -27,
		status: 'final',
		homeScore: 2,
		awayScore: 0
	},
	{
		eventId: 'wc2026-002',
		home: TEAMS.FRA,
		away: TEAMS.CAN,
		offsetHours: -3,
		status: 'final',
		homeScore: 1,
		awayScore: 1
	},
	{
		eventId: 'wc2026-003',
		home: TEAMS.BRA,
		away: TEAMS.USA,
		offsetHours: 0,
		status: 'in_progress',
		homeScore: 0,
		awayScore: 1
	},
	{
		eventId: 'wc2026-004',
		home: TEAMS.ESP,
		away: TEAMS.ENG,
		offsetHours: 26,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		eventId: 'wc2026-005',
		home: TEAMS.ENG,
		away: TEAMS.USA,
		offsetHours: 50,
		status: 'scheduled',
		homeScore: null,
		awayScore: null
	},
	{
		eventId: 'wc2026-006',
		home: TEAMS.MEX,
		away: TEAMS.CAN,
		offsetHours: 74,
		status: 'postponed',
		homeScore: null,
		awayScore: null
	}
];

function toEvent(seed: Seed, nowMs: number): FeedEvent {
	return {
		provider: PROVIDER,
		eventId: seed.eventId,
		league: LEAGUE,
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
