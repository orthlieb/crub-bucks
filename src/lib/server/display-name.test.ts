import { describe, it, expect } from 'vitest';
import { validateDisplayName, sanitizeDisplayName } from './display-name';

describe('validateDisplayName', () => {
	it('accepts a clean name', () => {
		expect(validateDisplayName('Marlena')).toEqual({ ok: true, value: 'Marlena' });
	});

	it('rejects profanity with a kid-friendly message', () => {
		const r = validateDisplayName('shithead');
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.message).toMatch(/rude/i);
	});

	it('enforces the minimum length', () => {
		expect(validateDisplayName('a').ok).toBe(false);
	});

	it('enforces the maximum length', () => {
		expect(validateDisplayName('x'.repeat(41)).ok).toBe(false);
	});

	it('strips invisible characters and collapses whitespace', () => {
		// zero-width space (U+200B) embedded; doubled spaces around.
		const r = validateDisplayName('  Ann​   Lee  ');
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toBe('Ann Lee');
	});
});

describe('sanitizeDisplayName', () => {
	it('drops control/bidi characters', () => {
		// U+202E is a right-to-left override used for spoofing.
		expect(sanitizeDisplayName('Bob‮')).toBe('Bob');
	});
});
