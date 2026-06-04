import { describe, it, expect } from 'vitest';
import { BADGES_BY_KEY, tierFor, nextTier, badgeIcon } from './badges';

describe('badge catalog', () => {
	it('tierFor returns the highest met tier', () => {
		const fs = BADGES_BY_KEY.get('first_steps')!;
		expect(tierFor(fs, 0)).toBeNull();
		expect(tierFor(fs, 4)).toBeNull();
		expect(tierFor(fs, 5)).toBe('bronze');
		expect(tierFor(fs, 24)).toBe('bronze');
		expect(tierFor(fs, 25)).toBe('silver');
		expect(tierFor(fs, 99)).toBe('silver');
		expect(tierFor(fs, 100)).toBe('gold');
		expect(tierFor(fs, 5000)).toBe('gold');
	});

	it('nextTier walks the ladder and caps at gold', () => {
		const fs = BADGES_BY_KEY.get('first_steps')!;
		expect(nextTier(fs, null)).toBe('bronze');
		expect(nextTier(fs, 'bronze')).toBe('silver');
		expect(nextTier(fs, 'silver')).toBe('gold');
		expect(nextTier(fs, 'gold')).toBeNull();
	});

	it('badgeIcon derives the slug path (underscore → hyphen)', () => {
		expect(badgeIcon('first_steps', 'gold')).toBe('/awards/first-steps-gold.png');
		expect(badgeIcon('all_in', 'bronze')).toBe('/awards/all-in-bronze.png');
	});

	it('approved thresholds match the catalog decisions', () => {
		expect(BADGES_BY_KEY.get('first_steps')!.thresholds).toEqual({
			bronze: 5,
			silver: 25,
			gold: 100
		});
		expect(BADGES_BY_KEY.get('winner')!.thresholds).toEqual({ bronze: 5, silver: 25, gold: 50 });
		expect(BADGES_BY_KEY.get('all_in')!.thresholds).toEqual({
			bronze: 100,
			silver: 1000,
			gold: 10000
		});
	});
});
