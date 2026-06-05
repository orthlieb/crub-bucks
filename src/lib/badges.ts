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
export type MetricKey =
	| 'bets_joined'
	| 'bets_won'
	| 'cb_wagered'
	| 'max_pot'
	| 'win_streak'
	| 'bets_settled'
	| 'friends'
	| 'cb_sent';

/** Display unit per metric, for progress hints ("12 / 25 bets"). */
export const METRIC_UNIT: Record<MetricKey, string> = {
	bets_joined: 'bets',
	bets_won: 'wins',
	cb_wagered: '₡',
	max_pot: '₡',
	win_streak: 'in a row',
	bets_settled: 'settled',
	friends: 'friends',
	cb_sent: '₡'
};

/** Plain-language description of what a metric counts, for the how-to tooltip. */
export const METRIC_HOWTO: Record<MetricKey, string> = {
	bets_joined: 'Join bets that go on to settle',
	bets_won: 'Win bets',
	cb_wagered: 'Total of all wagered Crub Bucks across all of your bets',
	max_pot: 'Be in a single big-pot bet',
	win_streak: 'Win bets back-to-back',
	bets_settled: 'Settle bets by being the one who resolves them',
	friends: 'Make friends (accepted friend requests)',
	cb_sent: 'Send Crub Bucks to other players (peer payments)'
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
		title: 'Running with the Pack',
		description: 'Sit. Stay. Bet.',
		emoji: '👣',
		metric: 'bets_joined',
		thresholds: { bronze: 5, silver: 25, gold: 100 }
	},
	{
		key: 'winner',
		title: 'Winner, Winner, Chicken Dinner!',
		description: "Tastes like someone else's money.",
		emoji: '🍗',
		metric: 'bets_won',
		thresholds: { bronze: 5, silver: 25, gold: 50 }
	},
	{
		key: 'all_in',
		title: 'All Bones In',
		description: 'For a dog with zero impulse control.',
		emoji: '🎰',
		metric: 'cb_wagered',
		thresholds: { bronze: 100, silver: 1000, gold: 10000 }
	},
	{
		key: 'big_bowl',
		title: 'Big Bowl',
		description: 'When the kibble really piles up.',
		emoji: '🥣',
		metric: 'max_pot',
		thresholds: { bronze: 50, silver: 250, gold: 1000 }
	},
	{
		key: 'bark_to_bark',
		title: 'Bark-to-Bark Wins',
		description: 'Back-to-back, now with more woof.',
		emoji: '🐶',
		metric: 'win_streak',
		thresholds: { bronze: 3, silver: 5, gold: 10 }
	},
	{
		// Art lives at /awards/dog-house-<tier>.png (key → slug swaps _ for -).
		key: 'dog_house',
		title: 'The Dog House',
		description: 'Where every bet comes to heel.',
		emoji: '🏠',
		metric: 'bets_settled',
		thresholds: { bronze: 5, silver: 25, gold: 100 }
	},
	{
		key: 'social',
		title: 'Social Butterfly',
		description: "A friend is just someone you haven't sniffed yet.",
		emoji: '🦋',
		metric: 'friends',
		thresholds: { bronze: 3, silver: 10, gold: 25 }
	},
	{
		key: 'throwing_bones',
		title: 'Throwing Bones',
		description: 'Easy come, easy bury.',
		emoji: '🦴',
		metric: 'cb_sent',
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

/** Tier "bug" medallion image (shown beside the Bronze/Silver/Gold label). */
export function tierBug(tier: BadgeTier): string {
	return `/bug-${tier}.png`;
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

/** One-line "how to earn" for tooltips: what's counted + each tier threshold. */
export function howToEarn(def: BadgeDef): string {
	const tiers = tiersOf(def)
		.map((t) => `${TIER_EMOJI[t]} ${def.thresholds[t]!.toLocaleString()}`)
		.join('  ');
	return `${METRIC_HOWTO[def.metric]} — ${tiers} ${METRIC_UNIT[def.metric]}`;
}
