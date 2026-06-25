import { describe, it, expect } from 'vitest';
import { deriveWinner } from './types';

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
