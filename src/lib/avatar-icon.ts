/**
 * Avatar icon (emoji) validation, shared by client and server.
 *
 * A user may pick a single emoji as their profile picture. The emoji-picker
 * only ever emits one emoji, but the set-icon endpoint is callable directly, so
 * the server re-validates: it must be exactly one grapheme cluster (a single
 * user-perceived character — emoji ZWJ sequences and skin-tone modifiers count
 * as one) and within a sane byte budget.
 */

// A generous cap: the longest standard emoji ZWJ sequences (e.g. the "family"
// and "people holding hands" variants) run to a couple dozen code points.
export const MAX_AVATAR_ICON_LENGTH = 64;

/**
 * Returns the trimmed icon if it is a single grapheme within the length cap,
 * otherwise null. Use the result directly: null means "no/invalid icon".
 */
export function sanitizeAvatarIcon(input: unknown): string | null {
	if (typeof input !== 'string') return null;
	const trimmed = input.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_AVATAR_ICON_LENGTH) return null;

	// Must be a single grapheme cluster. Intl.Segmenter is available in all our
	// runtime targets (Node 22+, modern browsers); fall back to a permissive
	// check if it's somehow missing.
	if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
		const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
		const graphemes = [...segmenter.segment(trimmed)];
		if (graphemes.length !== 1) return null;
	}

	// Reject plain ASCII "icons" — an avatar emoji should be a pictographic
	// character, not a letter, digit, or punctuation. (Checked via code points
	// rather than a regex to avoid a control-character range in the pattern.)
	const isAscii = [...trimmed].every((ch) => (ch.codePointAt(0) ?? 0) < 0x80);
	if (isAscii) return null;

	return trimmed;
}
