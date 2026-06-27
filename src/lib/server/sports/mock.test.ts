import { describe, it, expect } from 'vitest';
import { mockEvents, mockAdapter } from './mock';

const REF = Date.parse('2026-06-25T12:00:00Z');

describe('mockEvents', () => {
	it('produces a normalized schedule with mixed statuses', () => {
		const events = mockEvents(REF);
		expect(events.length).toBeGreaterThan(0);

		const statuses = new Set(events.map((e) => e.status));
		expect(statuses.has('final')).toBe(true);
		expect(statuses.has('scheduled')).toBe(true);
		expect(statuses.has('postponed')).toBe(true); // void/refund path is exercisable
	});

	it('derives winners only for final games', () => {
		for (const e of mockEvents(REF)) {
			if (e.status === 'final') {
				expect(e.winner).not.toBeNull();
				expect(e.homeScore).not.toBeNull();
			} else {
				expect(e.winner).toBeNull();
			}
		}
	});

	it('positions kickoff relative to the reference time', () => {
		const events = mockEvents(REF);
		const finals = events.filter((e) => e.status === 'final');
		const scheduled = events.filter((e) => e.status === 'scheduled');
		// finished games kicked off in the past, scheduled ones in the future
		for (const e of finals) expect(Date.parse(e.startTime)).toBeLessThan(REF);
		for (const e of scheduled) expect(Date.parse(e.startTime)).toBeGreaterThan(REF);
	});

	it('uses stable, provider-scoped event ids', () => {
		const ids = mockEvents(REF).map((e) => e.eventId);
		expect(new Set(ids).size).toBe(ids.length); // unique
		expect(mockEvents(REF).every((e) => e.provider === 'mock')).toBe(true);
	});

	it('spans more than one sport so the filter has something to do', () => {
		const sports = new Set(mockEvents(REF).map((e) => e.sport));
		expect(sports.has('soccer')).toBe(true);
		expect(sports.has('baseball')).toBe(true);
		// every event carries a sport + a league
		expect(mockEvents(REF).every((e) => e.sport && e.league)).toBe(true);
	});
});

describe('mockAdapter', () => {
	it('lists upcoming and looks up by id', async () => {
		const events = await mockAdapter.listUpcoming();
		const first = events[0];
		const found = await mockAdapter.getEvent(first.eventId);
		expect(found?.eventId).toBe(first.eventId);
	});

	it('returns null for an unknown id', async () => {
		expect(await mockAdapter.getEvent('no-such-game')).toBeNull();
	});
});
