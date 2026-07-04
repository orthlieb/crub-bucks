import { describe, it, expect } from 'vitest';
import { formatAmount, formatSigned } from './format';

// formatAmount takes internal coins (1/100 CB) and renders CB.
describe('formatAmount', () => {
	it('renders coins as CB and groups thousands per the en-US locale', () => {
		expect(formatAmount(100000, 'en-US')).toBe('1,000'); // 100000 coins = 1000 CB
		expect(formatAmount(123456700, 'en-US')).toBe('1,234,567');
	});

	it('groups thousands per the de-DE locale (period)', () => {
		expect(formatAmount(100000, 'de-DE')).toBe('1.000');
	});

	it('shows no decimals for whole CB but up to 2 for a coin fraction', () => {
		expect(formatAmount(4200, 'en-US')).toBe('42'); // whole CB
		expect(formatAmount(250, 'en-US')).toBe('2.5'); // 2.50 CB → trailing zero trimmed
		expect(formatAmount(1234, 'en-US')).toBe('12.34');
		expect(formatAmount(50, 'en-US')).toBe('0.5'); // half a CB
	});

	it('falls back gracefully for a bogus locale tag', () => {
		expect(() => formatAmount(100000, 'not-a-locale!!')).not.toThrow();
	});
});

describe('formatSigned', () => {
	it('prefixes a plus for positive amounts', () => {
		expect(formatSigned(2000, 'en-US')).toBe('+20');
		expect(formatSigned(100000, 'en-US')).toBe('+1,000');
		expect(formatSigned(250, 'en-US')).toBe('+2.5');
	});

	it('prefixes a U+2212 minus for negative amounts', () => {
		expect(formatSigned(-2000, 'en-US')).toBe('−20');
		expect(formatSigned(-1234, 'en-US')).toBe('−12.34');
	});

	it('leaves zero unsigned', () => {
		expect(formatSigned(0, 'en-US')).toBe('0');
	});
});
