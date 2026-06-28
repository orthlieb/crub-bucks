import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	normalizeEspnStatus,
	parseEspnScoreboard,
	parseEspnAthleteMatches,
	forwardWindow,
	espnAdapter
} from './espn';

describe('normalizeEspnStatus', () => {
	it('maps the common status names', () => {
		expect(normalizeEspnStatus('STATUS_SCHEDULED', 'pre', false)).toBe('scheduled');
		expect(normalizeEspnStatus('STATUS_IN_PROGRESS', 'in', false)).toBe('in_progress');
		expect(normalizeEspnStatus('STATUS_FULL_TIME', 'post', true)).toBe('final');
		expect(normalizeEspnStatus('STATUS_FINAL', 'post', true)).toBe('final');
		expect(normalizeEspnStatus('STATUS_POSTPONED', 'post', false)).toBe('postponed');
		expect(normalizeEspnStatus('STATUS_CANCELED', 'post', false)).toBe('cancelled');
		expect(normalizeEspnStatus('STATUS_ABANDONED', 'post', false)).toBe('cancelled');
	});

	it('falls back on state when the name is unknown', () => {
		expect(normalizeEspnStatus('STATUS_WEIRD', 'in', false)).toBe('in_progress');
		expect(normalizeEspnStatus('STATUS_WEIRD', 'post', false)).toBe('final');
		expect(normalizeEspnStatus(undefined, undefined, undefined)).toBe('scheduled');
	});

	it('prefers completed=true over an unmatched name', () => {
		expect(normalizeEspnStatus('STATUS_WEIRD', 'pre', true)).toBe('final');
	});
});

// A trimmed-but-realistic ESPN scoreboard payload.
const FIXTURE = {
	leagues: [
		{
			name: 'FIFA World Cup',
			logos: [
				{ href: 'https://a.espncdn.com/fifa-dark.png', rel: ['full', 'dark'] },
				{ href: 'https://a.espncdn.com/fifa.png', rel: ['full', 'default'] }
			]
		}
	],
	events: [
		{
			id: '700001',
			date: '2026-06-24T19:00Z',
			competitions: [
				{
					status: { type: { name: 'STATUS_FULL_TIME', state: 'post', completed: true } },
					competitors: [
						{
							homeAway: 'home',
							score: '3',
							team: {
								id: '1',
								displayName: 'Argentina',
								abbreviation: 'ARG',
								logo: 'https://a.espncdn.com/arg.png'
							}
						},
						{
							homeAway: 'away',
							score: '1',
							team: { id: '2', displayName: 'Mexico', abbreviation: 'MEX' } // no logo
						}
					]
				}
			]
		},
		{
			id: '700002',
			date: '2026-06-26T22:00Z',
			competitions: [
				{
					status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
					competitors: [
						{
							homeAway: 'home',
							score: '',
							team: { id: '3', displayName: 'Spain', abbreviation: 'ESP' }
						},
						{
							homeAway: 'away',
							score: '',
							team: { id: '4', displayName: 'England', abbreviation: 'ENG' }
						}
					]
				}
			]
		},
		// Malformed: no competitors — must be skipped, not throw.
		{ id: '700003', date: '2026-06-27T22:00Z', competitions: [{ status: {} }] }
	]
};

// A second sport's payload, used to verify the adapter aggregates competitions.
const BASEBALL_FIXTURE = {
	leagues: [{ name: 'MLB' }],
	events: [
		{
			id: '900001',
			date: '2026-06-26T23:05Z',
			competitions: [
				{
					status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
					competitors: [
						{
							homeAway: 'home',
							score: '5',
							team: { id: '10', displayName: 'New York Yankees', abbreviation: 'NYY' }
						},
						{
							homeAway: 'away',
							score: '3',
							team: { id: '11', displayName: 'Boston Red Sox', abbreviation: 'BOS' }
						}
					]
				}
			]
		}
	]
};

/** URL-aware fetch stub: serves the baseball payload on the MLB path and the
 *  soccer payload otherwise, so the adapter's parallel fetches are exercised. */
function stubFetch(opts: { soccer?: unknown; baseball?: unknown; status?: number } = {}) {
	const status = opts.status ?? 200;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string | URL) => {
			const u = String(url);
			const body = u.includes('/soccer/fifa.world/')
				? (opts.soccer ?? { events: [] })
				: u.includes('/baseball/mlb/')
					? (opts.baseball ?? { events: [] })
					: { events: [] }; // other competitions: empty, so tests are stable as the list grows
			return new Response(JSON.stringify(body), { status });
		})
	);
}

describe('parseEspnScoreboard', () => {
	it('parses a realistic payload into normalized events tagged with the sport', () => {
		const events = parseEspnScoreboard(FIXTURE, 'soccer', 'FIFA World Cup');
		expect(events).toHaveLength(2); // malformed one skipped

		const final = events[0];
		expect(final).toMatchObject({
			provider: 'espn',
			eventId: '700001',
			sport: 'soccer',
			league: 'FIFA World Cup',
			status: 'final',
			homeScore: 3,
			awayScore: 1,
			winner: 'home'
		});
		expect(final.home.abbr).toBe('ARG');
		expect(final.away.name).toBe('Mexico');
		// logos: team logo extracted; league logo prefers the non-dark variant;
		// a team without a logo is null (UI falls back to the abbreviation).
		expect(final.home.logo).toBe('https://a.espncdn.com/arg.png');
		expect(final.away.logo).toBeNull();
		expect(final.leagueLogo).toBe('https://a.espncdn.com/fifa.png');

		const upcoming = events[1];
		expect(upcoming).toMatchObject({
			eventId: '700002',
			status: 'scheduled',
			homeScore: null,
			awayScore: null,
			winner: null
		});
	});

	it('tolerates an empty / shapeless payload', () => {
		expect(parseEspnScoreboard({}, 'soccer')).toEqual([]);
		expect(parseEspnScoreboard(null, 'soccer')).toEqual([]);
		expect(parseEspnScoreboard({ events: [] }, 'soccer')).toEqual([]);
	});

	it('uses the fallback league name when the payload omits one', () => {
		const events = parseEspnScoreboard(
			{ events: FIXTURE.events.slice(0, 1) },
			'soccer',
			'MyLeague'
		);
		expect(events[0].league).toBe('MyLeague');
	});
});

// ESPN tennis nests matches as `competitions` under a tournament event, with
// athlete competitors and a per-competitor `winner` flag.
const TENNIS_FIXTURE = {
	leagues: [{ name: 'ATP' }],
	events: [
		{
			id: 'tourney-1',
			competitions: [
				{
					id: 'm1',
					date: '2026-06-28T13:00Z',
					status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
					competitors: [
						{
							homeAway: 'home',
							winner: true,
							score: '2',
							athlete: {
								id: 'a1',
								displayName: 'Carlos Alcaraz',
								abbreviation: 'ALC',
								flag: { href: 'https://a.espncdn.com/esp.png' }
							}
						},
						{
							homeAway: 'away',
							winner: false,
							score: '1',
							athlete: { id: 'a2', displayName: 'Novak Djokovic', abbreviation: 'DJO' }
						}
					]
				},
				{
					id: 'm2',
					date: '2026-06-29T13:00Z',
					status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
					competitors: [
						{
							homeAway: 'home',
							athlete: { id: 'a3', displayName: 'Jannik Sinner', abbreviation: 'SIN' }
						},
						{
							homeAway: 'away',
							athlete: { id: 'a4', displayName: 'Daniil Medvedev', abbreviation: 'MED' }
						}
					]
				}
			]
		}
	]
};

describe('parseEspnAthleteMatches', () => {
	it('parses per-match competitions with athletes + the winner flag', () => {
		const events = parseEspnAthleteMatches(TENNIS_FIXTURE, 'tennis', 'ATP');
		expect(events).toHaveLength(2); // two matches under one tournament event

		expect(events[0]).toMatchObject({
			provider: 'espn',
			eventId: 'm1',
			sport: 'tennis',
			league: 'ATP',
			status: 'final',
			winner: 'home'
		});
		expect(events[0].home.name).toBe('Carlos Alcaraz');
		expect(events[0].home.abbr).toBe('ALC');
		expect(events[0].home.logo).toBe('https://a.espncdn.com/esp.png'); // flag → logo

		expect(events[1]).toMatchObject({ eventId: 'm2', status: 'scheduled', winner: null });
		expect(events[1].away.name).toBe('Daniil Medvedev');
	});

	it('tolerates an empty payload', () => {
		expect(parseEspnAthleteMatches({}, 'tennis')).toEqual([]);
		expect(parseEspnAthleteMatches(null, 'tennis')).toEqual([]);
	});

	// MMA cards share tennis's per-match athlete shape: fights live under the
	// event's `competitions`, winner from the per-competitor flag, no scores.
	it('parses an MMA card with no numeric scores, winner from the flag', () => {
		const MMA_FIXTURE = {
			leagues: [{ name: 'UFC' }],
			events: [
				{
					id: 'ufc-card-1',
					competitions: [
						{
							id: 'fight-1',
							date: '2026-07-04T03:00Z',
							status: { type: { name: 'STATUS_FINAL', state: 'post', completed: true } },
							competitors: [
								{ order: 1, winner: true, athlete: { id: 'f1', displayName: 'Jon Jones' } },
								{ order: 2, winner: false, athlete: { id: 'f2', displayName: 'Tom Aspinall' } }
							]
						}
					]
				}
			]
		};
		const events = parseEspnAthleteMatches(MMA_FIXTURE, 'mma', 'UFC');
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			eventId: 'fight-1',
			sport: 'mma',
			league: 'UFC',
			status: 'final',
			winner: 'home',
			homeScore: null,
			awayScore: null
		});
		expect(events[0].home.name).toBe('Jon Jones');
		expect(events[0].away.name).toBe('Tom Aspinall');
	});
});

describe('forwardWindow', () => {
	it('formats a YYYYMMDD-YYYYMMDD range from the given day', () => {
		expect(forwardWindow(10, new Date('2026-06-28T12:00:00Z'))).toBe('20260628-20260708');
	});

	it('zero-pads month and day', () => {
		expect(forwardWindow(5, new Date('2026-01-03T00:00:00Z'))).toBe('20260103-20260108');
	});
});

describe('espnAdapter', () => {
	afterEach(() => vi.restoreAllMocks());

	it('requests a forward date window so upcoming (not just today) games come through', async () => {
		stubFetch({ soccer: FIXTURE, baseball: BASEBALL_FIXTURE });
		await espnAdapter.listUpcoming();
		const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
		expect(fetchMock).toHaveBeenCalled();
		for (const call of fetchMock.mock.calls) {
			expect(String(call[0])).toMatch(/scoreboard\?dates=\d{8}-\d{8}/);
		}
	});

	it('aggregates multiple competitions, tagging each with its sport', async () => {
		stubFetch({ soccer: FIXTURE, baseball: BASEBALL_FIXTURE });
		const events = await espnAdapter.listUpcoming();
		expect(events).toHaveLength(3); // 2 soccer + 1 baseball
		expect(new Set(events.map((e) => e.sport))).toEqual(new Set(['soccer', 'baseball']));
		expect(events.find((e) => e.eventId === '900001')?.league).toBe('MLB');
	});

	it('getEvent finds a single event by id across sports', async () => {
		stubFetch({ soccer: FIXTURE, baseball: BASEBALL_FIXTURE });
		expect((await espnAdapter.getEvent('700002'))?.home.abbr).toBe('ESP');
		expect((await espnAdapter.getEvent('900001'))?.sport).toBe('baseball');
		expect(await espnAdapter.getEvent('does-not-exist')).toBeNull();
	});

	it('fails safe to [] on a non-OK response', async () => {
		stubFetch({ soccer: FIXTURE, baseball: BASEBALL_FIXTURE, status: 503 });
		expect(await espnAdapter.listUpcoming()).toEqual([]);
	});

	it('one competition failing does not sink the others', async () => {
		// Baseball throws; soccer still returns its events.
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string | URL) => {
				const u = String(url);
				if (u.includes('/baseball/mlb/')) throw new Error('mlb down');
				if (u.includes('/soccer/fifa.world/'))
					return new Response(JSON.stringify(FIXTURE), { status: 200 });
				return new Response(JSON.stringify({ events: [] }), { status: 200 });
			})
		);
		const events = await espnAdapter.listUpcoming();
		expect(events).toHaveLength(2);
		expect(events.every((e) => e.sport === 'soccer')).toBe(true);
	});

	it('fails safe to [] / null on a total network error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new Error('egress blocked');
			})
		);
		expect(await espnAdapter.listUpcoming()).toEqual([]);
		expect(await espnAdapter.getEvent('700001')).toBeNull();
	});
});
