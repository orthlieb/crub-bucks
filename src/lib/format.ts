/**
 * Locale-aware amount formatting for Crub Bucks. The `locale` should be the
 * visitor's locale (derived from the Accept-Language header in the root
 * layout) so server-rendered and client-rendered amounts agree.
 *
 * CB are whole numbers, so we never show fractional digits; the locale only
 * affects the grouping separator (1,000 in en-US, 1.000 in de-DE, etc.).
 */

export function formatAmount(n: number, locale?: string): string {
	try {
		return n.toLocaleString(locale, { maximumFractionDigits: 0 });
	} catch {
		// Invalid/unsupported BCP-47 tag → fall back to the runtime default.
		return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
	}
}

/** Signed amount with an explicit +/− (uses the U+2212 minus glyph). */
export function formatSigned(n: number, locale?: string): string {
	const abs = formatAmount(Math.abs(n), locale);
	if (n > 0) return `+${abs}`;
	if (n < 0) return `−${abs}`;
	return abs;
}
