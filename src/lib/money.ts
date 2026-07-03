/**
 * Crub Bucks are stored internally at 1/100-CB precision — "Crub Coins", or
 * centi-CB. This sub-unit exists ONLY so parimutuel/pot splits divide fairly
 * (a 1 CB pool over two winners is 50 + 50 coins, not 1 + 0). It is never a
 * user-facing denomination: amounts are ENTERED as whole CB and DISPLAYED as CB
 * (with up to 2 decimals when a split produced a fraction — see formatAmount).
 *
 * The ledger and all settlement math operate purely on these integer coins, so
 * the "integers only / zero-sum" invariant holds unchanged — the integer is
 * just finer now.
 */
export const CENTI_PER_CB = 100;

/**
 * Parse a user-entered WHOLE-CB amount into integer coins. Returns null when the
 * value isn't a positive whole number of CB — users never enter fractions, so a
 * fractional or non-positive entry is rejected at the form boundary.
 */
export function wholeCbToCoins(raw: unknown): number | null {
	const cb = Number(raw);
	if (!Number.isInteger(cb) || cb < 1) return null;
	return cb * CENTI_PER_CB;
}
