import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeEspnStatus, parseEspnScoreboard, espnAdapter } from './espn';

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
	leagues: [{ name: 'FIFA World Cup' }],
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
							team: { id: '1', displayName: 'Argentina', abbreviation: 'ARG' }
						},
						{
							homeAway: 'away',
							score: '1',
							team: { id: '2', displayName: 'Mexico', abbreviation: 'MEX' }
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

describe('parseEspnScoreboard', () => {
	it('parses a realistic payload into normalized events', () => {
		const events = parseEspnScoreboard(FIXTURE);
		expect(events).toHaveLength(2); // malformed one skipped

		const final = events[0];
		expect(final).toMatchObject({
			provider: 'espn',
			eventId: '700001',
			league: 'FIFA World Cup',
			status: 'final',
			homeScore: 3,
			awayScore: 1,
			winner: 'home'
		});
		expect(final.home.abbr).toBe('ARG');
		expect(final.away.name).toBe('Mexico');

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
		expect(parseEspnScoreboard({})).toEqual([]);
		expect(parseEspnScoreboard(null)).toEqual([]);
		expect(parseEspnScoreboard({ events: [] })).toEqual([]);
	});

	it('defaults the league name when absent', () => {
		const events = parseEspnScoreboard({ events: FIXTURE.events.slice(0, 1) });
		expect(events[0].league).toBe('FIFA World Cup');
	});
});

describe('espnAdapter', () => {
	afterEach(() => vi.restoreAllMocks());

	it('listUpcoming returns parsed events on a 200', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 }))
		);
		const events = await espnAdapter.listUpcoming();
		expect(events).toHaveLength(2);
	});

	it('getEvent finds a single event by id', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify(FIXTURE), { status: 200 }))
		);
		const ev = await espnAdapter.getEvent('700002');
		expect(ev?.home.abbr).toBe('ESP');
		expect(await espnAdapter.getEvent('does-not-exist')).toBeNull();
	});

	it('fails safe to [] on a non-OK response', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('nope', { status: 503 }))
		);
		expect(await espnAdapter.listUpcoming()).toEqual([]);
	});

	it('fails safe to [] / null on a network error', async () => {
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
