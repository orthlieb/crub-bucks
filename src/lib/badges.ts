/**
 * Badge registry — pure, shared by the server (awarding) and client (the
 * Awards wall + feed). Badge *definitions* live here; awards persist in the
 * `user_badges` table. See docs/badges-and-rewards.md.
 *
 * Model: one badge per user, tier upgraded in place (bronze → silver → gold,
 * forward only). A badge may define 1–3 tiers.
 */

export type BadgeTier = 'bronze' | 'silver' | 'gold';

export const TIER_ORDER: BadgeTier[] = ['bronze', 'silver', 'gold'];
export const TIER_RANK: Record<BadgeTier, number> = { bronze: 1, silver: 2, gold: 3 };
export const TIER_LABEL: Record<BadgeTier, string> = {
	bronze: 'Bronze',
	silver: 'Silver',
	gold: 'Gold'
};
export const TIER_EMOJI: Record<BadgeTier, string> = {
	bronze: '🥉',
	silver: '🥈',
	gold: '🥇'
};

/** Lifetime, monotonic metrics the current badges read. */
export type MetricKey = 'bets_joined' | 'bets_won' | 'cb_wagered';

/** Display unit per metric, for progress hints ("12 / 25 bets"). */
export const METRIC_UNIT: Record<MetricKey, string> = {
	bets_joined: 'bets',
	bets_won: 'wins',
	cb_wagered: '₡'
};

export interface BadgeDef {
	key: string; // snake_case, e.g. 'first_steps'
	title: string;
	description: string;
	emoji: string; // tier-agnostic emoji for text contexts (notifications/feed)
	metric: MetricKey;
	/** Ascending thresholds; a badge may omit tiers (1–3 tiers allowed). */
	thresholds: Partial<Record<BadgeTier, number>>;
}

export const BADGES: BadgeDef[] = [
	{
		key: 'first_steps',
		title: 'First Steps',
		description: 'Get in the game — join bets with your friends.',
		emoji: '👣',
		metric: 'bets_joined',
		thresholds: { bronze: 5, silver: 25, gold: 100 }
	},
	{
		key: 'winner',
		title: 'Winner, winner, chicken dinner!',
		description: 'Come out on top.',
		emoji: '🍗',
		metric: 'bets_won',
		thresholds: { bronze: 5, silver: 25, gold: 50 }
	},
	{
		key: 'all_in',
		title: 'All-In',
		description: 'For a dog with zero impulse control.',
		emoji: '🎰',
		metric: 'cb_wagered',
		thresholds: { bronze: 100, silver: 1000, gold: 10000 }
	}
];

export const BADGES_BY_KEY: Map<string, BadgeDef> = new Map(BADGES.map((b) => [b.key, b]));

/** Tiers a badge actually defines, ascending. */
export function tiersOf(def: BadgeDef): BadgeTier[] {
	return TIER_ORDER.filter((t) => def.thresholds[t] !== undefined);
}

/** Highest tier whose threshold `value` meets, or null if none. */
export function tierFor(def: BadgeDef, value: number): BadgeTier | null {
	let earned: BadgeTier | null = null;
	for (const tier of TIER_ORDER) {
		const t = def.thresholds[tier];
		if (t !== undefined && value >= t) earned = tier;
	}
	return earned;
}

/** Per-tier art path, by convention: /awards/<slug>-<tier>.png. */
export function badgeIcon(key: string, tier: BadgeTier): string {
	return `/awards/${key.replaceAll('_', '-')}-${tier}.png`;
}

/**
 * Single tintable silhouette, by convention: /awards/<slug>.svg. One asset per
 * badge that the UI fills with the tier color (or a muted "ghost" when locked),
 * so a badge needs only one image instead of three. Preferred over per-tier art.
 */
export function badgeSilhouette(key: string): string {
	return `/awards/${key.replaceAll('_', '-')}.svg`;
}

/** Tier accent colors — rings/frames and single-image silhouette tinting. */
export const TIER_COLOR: Record<BadgeTier, string> = {
	bronze: '#cd7f32',
	silver: '#9ca3af',
	gold: '#f5b301'
};

/** The next tier above `current` (or the first tier if not yet earned), or null at max. */
export function nextTier(def: BadgeDef, current: BadgeTier | null): BadgeTier | null {
	const tiers = tiersOf(def);
	if (!current) return tiers[0] ?? null;
	const idx = tiers.indexOf(current);
	return idx >= 0 && idx + 1 < tiers.length ? tiers[idx + 1] : null;
}
