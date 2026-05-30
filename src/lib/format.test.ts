import { describe, it, expect } from 'vitest';
import { formatAmount, formatSigned } from './format';

describe('formatAmount', () => {
	it('groups thousands per the en-US locale (comma)', () => {
		expect(formatAmount(1000, 'en-US')).toBe('1,000');
		expect(formatAmount(1234567, 'en-US')).toBe('1,234,567');
	});

	it('groups thousands per the de-DE locale (period)', () => {
		expect(formatAmount(1000, 'de-DE')).toBe('1.000');
	});

	it('shows no fractional digits for whole numbers', () => {
		expect(formatAmount(42, 'en-US')).toBe('42');
	});

	it('falls back gracefully for a bogus locale tag', () => {
		// Should not throw; returns some grouped string.
		expect(() => formatAmount(1000, 'not-a-locale!!')).not.toThrow();
	});
});

describe('formatSigned', () => {
	it('prefixes a plus for positive amounts', () => {
		expect(formatSigned(20, 'en-US')).toBe('+20');
		expect(formatSigned(1000, 'en-US')).toBe('+1,000');
	});

	it('prefixes a U+2212 minus for negative amounts', () => {
		expect(formatSigned(-20, 'en-US')).toBe('−20');
		expect(formatSigned(-1000, 'en-US')).toBe('−1,000');
	});

	it('leaves zero unsigned', () => {
		expect(formatSigned(0, 'en-US')).toBe('0');
	});
});
