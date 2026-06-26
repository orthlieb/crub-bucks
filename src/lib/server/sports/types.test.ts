import { describe, it, expect } from 'vitest';
import { deriveWinner, dedupeEvents } from './types';
import type { FeedEvent } from './types';

// Minimal FeedEvent factory for dedup tests.
function ev(over: Partial<FeedEvent> & Pick<FeedEvent, 'provider' | 'eventId'>): FeedEvent {
	return {
		sport: 'soccer',
		league: 'FIFA World Cup',
		leagueLogo: null,
		startTime: '2026-06-26T19:00:00.000Z',
		status: 'scheduled',
		home: { id: 'h', name: 'Home', abbr: 'HOM', logo: null },
		away: { id: 'a', name: 'Away', abbr: 'AWY', logo: null },
		homeScore: null,
		awayScore: null,
		winner: null,
		...over
	};
}

describe('deriveWinner', () => {
	it('returns home/away/draw for a final game', () => {
		expect(deriveWinner('final', 2, 0)).toBe('home');
		expect(deriveWinner('final', 0, 1)).toBe('away');
		expect(deriveWinner('final', 1, 1)).toBe('draw');
	});

	it('returns null when the game is not final', () => {
		expect(deriveWinner('in_progress', 1, 0)).toBeNull();
		expect(deriveWinner('scheduled', null, null)).toBeNull();
		expect(deriveWinner('postponed', null, null)).toBeNull();
	});

	it('returns null when a score is missing even if final', () => {
		expect(deriveWinner('final', null, 1)).toBeNull();
		expect(deriveWinner('final', 2, null)).toBeNull();
	});
});

describe('dedupeEvents', () => {
	it('is a no-op when nothing collides', () => {
		const a = ev({
			provider: 'espn',
			eventId: '1',
			home: { id: 'x', name: 'X', abbr: 'AAA', logo: null }
		});
		const b = ev({
			provider: 'espn',
			eventId: '2',
			home: { id: 'y', name: 'Y', abbr: 'BBB', logo: null }
		});
		expect(dedupeEvents([a, b])).toHaveLength(2);
	});

	it('collapses the same game from two providers into one', () => {
		const fromA = ev({ provider: 'espn', eventId: '700001' });
		const fromB = ev({ provider: 'other', eventId: 'zzz' }); // same sport/day/teams
		const out = dedupeEvents([fromA, fromB]);
		expect(out).toHaveLength(1);
	});

	it('keeps the more-resolved copy on a collision regardless of order', () => {
		const stub = ev({ provider: 'espn', eventId: '1', status: 'scheduled' });
		const finalRes = ev({
			provider: 'other',
			eventId: '2',
			status: 'final',
			homeScore: 2,
			awayScore: 1,
			winner: 'home'
		});
		expect(dedupeEvents([stub, finalRes])[0].status).toBe('final');
		expect(dedupeEvents([finalRes, stub])[0].status).toBe('final');
	});

	it('does not merge the same teams on different days or different sports', () => {
		const day1 = ev({ provider: 'p', eventId: '1', startTime: '2026-06-26T19:00:00Z' });
		const day2 = ev({ provider: 'p', eventId: '2', startTime: '2026-06-27T19:00:00Z' });
		const otherSport = ev({ provider: 'p', eventId: '3', sport: 'baseball' });
		expect(dedupeEvents([day1, day2])).toHaveLength(2);
		expect(dedupeEvents([day1, otherSport])).toHaveLength(2);
	});

	it('never merges events that lack team identifiers', () => {
		const blank = { id: '', name: '', abbr: '', logo: null };
		const a = ev({ provider: 'p', eventId: '1', home: blank, away: blank });
		const b = ev({ provider: 'p', eventId: '2', home: blank, away: blank });
		expect(dedupeEvents([a, b])).toHaveLength(2);
	});
});
