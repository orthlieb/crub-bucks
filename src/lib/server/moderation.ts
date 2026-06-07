import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

/**
 * Profanity / expletive filter for user-generated text — display names, bet
 * titles, comments/notes, and payment memos. Crub Bucks is kid-friendly, so
 * the policy is **reject on match**: flagged text is never stored or shown.
 *
 * Built on obscenity's English dataset with the recommended transformers,
 * which match on word boundaries (avoiding the "Scunthorpe problem" of
 * substring false positives) and defuse common evasions — leetspeak (`sh1t`),
 * spacing (`f u c k`), and repeated letters (`fuuuck`). Runs fully offline:
 * no user text is ever sent to a third party (important for a kids' app).
 *
 * No filter is perfect — pair this with user reporting (see /app/report) as
 * defense in depth.
 */

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers
});

// App-specific extras to reject on top of the dataset. Matched case-insensitively
// as whole words. Keep this short and high-signal; add terms as they come up.
const EXTRA_BLOCKLIST: readonly string[] = [];

// Innocent words obscenity's dataset flags as false positives (it matches a
// rude substring the built-in whitelist doesn't cover). We blank these whole
// words out before matching. Add to this list as real names/words surface.
const ALLOWLIST: readonly string[] = ['cockpit', 'shiitake', 'penistone'];

const extraRe = EXTRA_BLOCKLIST.length
	? new RegExp(`\\b(?:${EXTRA_BLOCKLIST.map(escapeRegExp).join('|')})\\b`, 'i')
	: null;
const allowRe = ALLOWLIST.length
	? new RegExp(`\\b(?:${ALLOWLIST.map(escapeRegExp).join('|')})\\b`, 'gi')
	: null;

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True if the text contains profanity or a blocked term. Empty text is clean. */
export function containsProfanity(text: string | null | undefined): boolean {
	if (!text) return false;
	// Remove known-safe words first so their rude substrings don't false-trip.
	const cleaned = allowRe ? text.replace(allowRe, ' ') : text;
	if (matcher.hasMatch(cleaned)) return true;
	if (extraRe && extraRe.test(cleaned)) return true;
	return false;
}

export type CleanResult = { ok: true } | { ok: false; message: string };

/**
 * Reject-on-match check with a friendly, kid-appropriate message. `what` names
 * the field for the error (e.g. 'name', 'title', 'comment', 'note', 'memo').
 */
export function checkClean(text: string | null | undefined, what = 'text'): CleanResult {
	if (containsProfanity(text)) {
		return {
			ok: false,
			message: `Let's keep it kind — that ${what} has a word we don't allow. Please reword it.`
		};
	}
	return { ok: true };
}
