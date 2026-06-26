/**
 * Sports feed — normalized event model.
 *
 * Different providers (ESPN, football-data.org, TheSportsDB, …) each return a
 * different JSON shape with their own ids and status vocabularies. Every adapter
 * normalizes into the {@link FeedEvent} shape below so the rest of the app — and
 * eventually the bet-resolution layer — only ever sees ONE contract.
 *
 * Only four things are load-bearing for settling a bet: a stable id to bind to
 * (`provider` + `eventId`), when it starts (`startTime`), where it is in its
 * lifecycle (`status`), and the score once it's final. Everything else is for
 * display.
 */

/** Provider-agnostic lifecycle of a single game. */
export type FeedEventStatus =
	| 'scheduled' // not started yet — enrollment can stay open
	| 'in_progress' // live — enrollment closed, not yet settleable
	| 'final' // officially over — safe to resolve
	| 'postponed' // moved to a later date — void/refund any bet
	| 'cancelled'; // will not be played — void/refund any bet

export interface FeedTeam {
	/** Provider-scoped team id. */
	id: string;
	name: string;
	/** Short code, e.g. "ARG", "FRA". May be empty if the provider omits it. */
	abbr: string;
}

export interface FeedEvent {
	/** Which adapter produced this, e.g. "espn" or "mock". */
	provider: string;
	/**
	 * Provider-scoped event id. NOT globally unique — always pair it with
	 * `provider` when persisting, because ids collide across providers.
	 */
	eventId: string;
	/** Sport family, e.g. "soccer" or "baseball". Drives the sport filter. */
	sport: string;
	/** Human league/competition name, e.g. "FIFA World Cup" or "MLB". */
	league: string;
	/** Kickoff, ISO-8601 UTC. This is the natural "enrollment closes" deadline. */
	startTime: string;
	status: FeedEventStatus;
	home: FeedTeam;
	away: FeedTeam;
	/** Null until a score is known (i.e. game hasn't produced one yet). */
	homeScore: number | null;
	awayScore: number | null;
	/**
	 * Convenience outcome derived from the scores once the game is `final`.
	 * `'draw'` is possible in soccer group play; null while the result is unknown.
	 */
	winner: 'home' | 'away' | 'draw' | null;
}

/**
 * Every provider integration implements this. The feature code depends only on
 * the interface, so swapping providers (or dropping in the mock for offline dev)
 * is a one-line change in {@link getFeed}.
 */
export interface FeedAdapter {
	readonly provider: string;
	/** Upcoming + recent games for the configured competition. */
	listUpcoming(): Promise<FeedEvent[]>;
	/** A single event by its provider id, or null if not found / unreachable. */
	getEvent(eventId: string): Promise<FeedEvent | null>;
}

/**
 * Derive the win/draw outcome from a status + scores. Returns null unless the
 * game is `final` with both scores present — we never guess a winner from a
 * game still in progress.
 */
export function deriveWinner(
	status: FeedEventStatus,
	homeScore: number | null,
	awayScore: number | null
): FeedEvent['winner'] {
	if (status !== 'final' || homeScore === null || awayScore === null) return null;
	if (homeScore > awayScore) return 'home';
	if (awayScore > homeScore) return 'away';
	return 'draw';
}

// How "settled" each status is — higher wins when two providers report the same
// game. A final result should always beat a scheduled stub.
const STATUS_RANK: Record<FeedEventStatus, number> = {
	final: 4,
	in_progress: 3,
	postponed: 2,
	cancelled: 2,
	scheduled: 1
};

/**
 * Collapse events that represent the SAME real-world game arriving from more
 * than one provider. With a single provider this is a no-op — each provider's
 * event ids are already unique — so it's cheap insurance that only does real
 * work once two feeds overlap.
 *
 * Cross-provider identity is necessarily fuzzy (ids and naming differ between
 * sources): same sport, same UTC calendar day, same two teams by abbreviation
 * (case-insensitive). When a team has no abbreviation we fall back to its id or
 * name, and if even that is missing we key on provider+eventId so distinct
 * games are never merged by accident. On a collision we keep the more-resolved
 * event (see {@link STATUS_RANK}); ties keep the first seen.
 */
export function dedupeEvents(events: FeedEvent[]): FeedEvent[] {
	const byKey = new Map<string, FeedEvent>();
	for (const e of events) {
		const homeK = e.home.abbr || e.home.id || e.home.name;
		const awayK = e.away.abbr || e.away.id || e.away.name;
		const day = e.startTime.slice(0, 10); // YYYY-MM-DD from the ISO timestamp
		const key =
			homeK && awayK
				? `${e.sport}|${day}|${homeK.toLowerCase()}|${awayK.toLowerCase()}`
				: `${e.provider}:${e.eventId}`; // not enough to match on — keep it unique
		const existing = byKey.get(key);
		if (!existing || STATUS_RANK[e.status] > STATUS_RANK[existing.status]) byKey.set(key, e);
	}
	return [...byKey.values()];
}
