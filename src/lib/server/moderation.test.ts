import { describe, it, expect } from 'vitest';
import { containsProfanity, checkClean } from './moderation';

describe('moderation: containsProfanity', () => {
	it('passes clean text', () => {
		expect(containsProfanity('Best deck challenge')).toBe(false);
		expect(containsProfanity('Marlena')).toBe(false);
		expect(containsProfanity('')).toBe(false);
		expect(containsProfanity(null)).toBe(false);
		expect(containsProfanity(undefined)).toBe(false);
	});

	it('avoids the Scunthorpe problem (no substring false positives)', () => {
		expect(containsProfanity('classic')).toBe(false);
		expect(containsProfanity('assess the class')).toBe(false);
		expect(containsProfanity('Scunthorpe')).toBe(false);
		// Allowlisted words whose rude substrings would otherwise trip the filter.
		expect(containsProfanity('cockpit instruments')).toBe(false);
		expect(containsProfanity('shiitake mushrooms')).toBe(false);
	});

	it('flags strong profanity', () => {
		expect(containsProfanity('this is shit')).toBe(true);
		expect(containsProfanity('fuck that')).toBe(true);
	});

	it('catches common leetspeak / obfuscation', () => {
		expect(containsProfanity('sh1t')).toBe(true);
		expect(containsProfanity('f*ck')).toBe(true);
		expect(containsProfanity('fuuuck')).toBe(true);
	});
});

describe('moderation: checkClean', () => {
	it('returns ok for clean text', () => {
		expect(checkClean('hello', 'name')).toEqual({ ok: true });
	});

	it('returns a friendly, field-named message on a match', () => {
		const r = checkClean('shit', 'title');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/title/);
	});
});
