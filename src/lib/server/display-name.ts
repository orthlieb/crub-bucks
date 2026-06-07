/**
 * Display-name validation shared by registration and the in-app rename.
 *
 * Names render as plain, auto-escaped text everywhere (no `{@html}`), so this
 * isn't about XSS — it's about preventing impersonation/spoofing and broken
 * layouts: we strip control, zero-width/invisible, and Unicode bidi-override
 * characters, NFC-normalize, and collapse whitespace. We also reject names
 * containing profanity (kid-friendly app).
 */

import { containsProfanity } from './moderation';

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;

// Code-point ranges to strip. Expressed numerically so there are no invisible
// literals in the source.
const UNSAFE_RANGES: ReadonlyArray<readonly [number, number]> = [
	[0x00, 0x1f], // C0 control chars (NUL, newline, tab, …)
	[0x7f, 0x9f], // DEL + C1 control chars
	[0x200b, 0x200f], // zero-width space/joiners, LRM/RLM
	[0x202a, 0x202e], // bidi embeddings & overrides (U+202E spoofing)
	[0x2066, 0x2069], // bidi isolates
	[0xfeff, 0xfeff] // BOM / zero-width no-break space
];

function isUnsafeChar(cp: number): boolean {
	return UNSAFE_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

/** Normalize, strip dangerous characters, then collapse whitespace. */
export function sanitizeDisplayName(raw: string): string {
	let out = '';
	for (const ch of raw.normalize('NFC')) {
		const cp = ch.codePointAt(0);
		if (cp !== undefined && !isUnsafeChar(cp)) out += ch;
	}
	return out.replace(/\s+/g, ' ').trim();
}

export type DisplayNameResult =
	| { ok: true; value: string }
	| { ok: false; message: string };

/** Sanitize and bounds-check a raw display name in one step. */
export function validateDisplayName(raw: string): DisplayNameResult {
	const value = sanitizeDisplayName(raw ?? '');
	if (value.length < DISPLAY_NAME_MIN) {
		return { ok: false, message: `Display name must be at least ${DISPLAY_NAME_MIN} characters.` };
	}
	if (value.length > DISPLAY_NAME_MAX) {
		return { ok: false, message: `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.` };
	}
	if (containsProfanity(value)) {
		return { ok: false, message: 'Please choose a name without rude words.' };
	}
	return { ok: true, value };
}
