/**
 * Auto-generated one-line summaries for a bet card's comment slot, used when
 * there's no human-written note. Shared by the activity feed and the dashboard
 * so both phrase things identically.
 */

/** "A", "A & B", "A, B & C". */
export function nameList(names: string[]): string {
	if (names.length === 0) return 'nobody';
	if (names.length === 1) return names[0];
	if (names.length === 2) return `${names[0]} & ${names[1]}`;
	return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

/** Resolved: a single winner "won"; multiple winners "tied" (split the pot). */
export function resolvedSummary(winnerNames: string[]): string {
	if (winnerNames.length === 0) return 'Settled';
	if (winnerNames.length === 1) return `${winnerNames[0]} won`;
	return `${nameList(winnerNames)} tied`;
}

/** Cancelled: who called it off. */
export function cancelledSummary(cancellerName: string | null): string {
	return cancellerName ? `${cancellerName} called it off` : 'Bet cancelled';
}

/** Pending: who still has to accept before the bet goes live. */
export function pendingSummary(waitingNames: string[]): string {
	if (waitingNames.length === 0) return 'Everyone has accepted';
	return `Waiting on ${nameList(waitingNames)}`;
}
