import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/** Display-name bounds — min mirrors registration; max keeps the UI tidy. */
const DISPLAY_NAME_MIN = 2;
const DISPLAY_NAME_MAX = 40;

// Code-point ranges we strip from display names before storing. Names render as
// plain text everywhere (Svelte auto-escapes, so this isn't about XSS) — this is
// about preventing impersonation/spoofing and broken layouts. Expressed as
// numeric ranges so there are no invisible literals in the source.
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
function sanitizeDisplayName(raw: string): string {
	let out = '';
	for (const ch of raw.normalize('NFC')) {
		const cp = ch.codePointAt(0);
		if (cp !== undefined && !isUnsafeChar(cp)) out += ch;
	}
	return out.replace(/\s+/g, ' ').trim();
}

/** Update the current user's display name. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let raw = '';
	try {
		const body = await request.json();
		raw = typeof body?.displayName === 'string' ? body.displayName : '';
	} catch {
		throw error(400, 'Invalid request');
	}

	const displayName = sanitizeDisplayName(raw);
	if (displayName.length < DISPLAY_NAME_MIN) {
		throw error(422, `Display name must be at least ${DISPLAY_NAME_MIN} characters.`);
	}
	if (displayName.length > DISPLAY_NAME_MAX) {
		throw error(422, `Display name must be ${DISPLAY_NAME_MAX} characters or fewer.`);
	}

	await db.update(users).set({ displayName }).where(eq(users.id, locals.user.id));
	return json({ ok: true, displayName });
};
