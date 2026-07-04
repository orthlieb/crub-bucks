import { describe, it, expect } from 'vitest';
import { CENTI_PER_CB, wholeCbToCoins } from './money';

describe('wholeCbToCoins', () => {
	it('scales a positive whole-CB entry to coins', () => {
		expect(wholeCbToCoins('1')).toBe(CENTI_PER_CB);
		expect(wholeCbToCoins('25')).toBe(2500);
		expect(wholeCbToCoins(10)).toBe(1000);
	});

	it('rejects non-positive, fractional, or non-numeric entries', () => {
		expect(wholeCbToCoins('0')).toBeNull();
		expect(wholeCbToCoins('-5')).toBeNull();
		expect(wholeCbToCoins('1.5')).toBeNull();
		expect(wholeCbToCoins('')).toBeNull();
		expect(wholeCbToCoins('abc')).toBeNull();
		expect(wholeCbToCoins(null)).toBeNull();
	});
});
