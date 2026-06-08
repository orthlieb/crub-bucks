import { describe, it, expect } from 'vitest';
import { sanitizeAvatarIcon, MAX_AVATAR_ICON_LENGTH } from './avatar-icon';

describe('sanitizeAvatarIcon', () => {
	it('accepts a single emoji', () => {
		expect(sanitizeAvatarIcon('🦊')).toBe('🦊');
		expect(sanitizeAvatarIcon('🎲')).toBe('🎲');
	});

	it('accepts a single multi-codepoint emoji (ZWJ / skin tone) as one grapheme', () => {
		expect(sanitizeAvatarIcon('👍🏽')).toBe('👍🏽'); // emoji + skin-tone modifier
		expect(sanitizeAvatarIcon('👩‍🚀')).toBe('👩‍🚀'); // ZWJ sequence
	});

	it('trims surrounding whitespace', () => {
		expect(sanitizeAvatarIcon('  🦊  ')).toBe('🦊');
	});

	it('rejects more than one grapheme', () => {
		expect(sanitizeAvatarIcon('🦊🎲')).toBeNull();
		expect(sanitizeAvatarIcon('🦊 🎲')).toBeNull();
	});

	it('rejects plain ASCII letters, digits, and punctuation', () => {
		expect(sanitizeAvatarIcon('A')).toBeNull();
		expect(sanitizeAvatarIcon('7')).toBeNull();
		expect(sanitizeAvatarIcon('!')).toBeNull();
		expect(sanitizeAvatarIcon('hello')).toBeNull();
	});

	it('rejects empty / whitespace-only / non-string input', () => {
		expect(sanitizeAvatarIcon('')).toBeNull();
		expect(sanitizeAvatarIcon('   ')).toBeNull();
		expect(sanitizeAvatarIcon(null)).toBeNull();
		expect(sanitizeAvatarIcon(undefined)).toBeNull();
		expect(sanitizeAvatarIcon(42)).toBeNull();
	});

	it('rejects an over-long string before doing grapheme work', () => {
		expect(sanitizeAvatarIcon('🦊'.repeat(MAX_AVATAR_ICON_LENGTH))).toBeNull();
	});
});
