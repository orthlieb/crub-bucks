import { CENTI_PER_CB } from './money';

/**
 * Locale-aware amount formatting for Crub Bucks. Input is the internal integer
 * coin amount (1/100 CB); output is CB. The `locale` should be the visitor's
 * locale (from the Accept-Language header in the root layout) so server- and
 * client-rendered amounts agree.
 *
 * Whole CB show no decimals; a coin fraction from a split shows up to 2 (e.g.
 * 100 → "1", 250 → "2.5", 1234 → "12.34"). The locale affects the grouping
 * separator (1,000 in en-US, 1.000 in de-DE, etc.).
 */

export function formatAmount(coins: number, locale?: string): string {
	const cb = coins / CENTI_PER_CB;
	try {
		return cb.toLocaleString(locale, { maximumFractionDigits: 2 });
	} catch {
		// Invalid/unsupported BCP-47 tag → fall back to the runtime default.
		return cb.toLocaleString(undefined, { maximumFractionDigits: 2 });
	}
}

/** Signed amount with an explicit +/− (uses the U+2212 minus glyph). */
export function formatSigned(n: number, locale?: string): string {
	const abs = formatAmount(Math.abs(n), locale);
	if (n > 0) return `+${abs}`;
	if (n < 0) return `−${abs}`;
	return abs;
}
