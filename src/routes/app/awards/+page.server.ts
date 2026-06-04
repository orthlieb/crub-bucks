import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { userBadges } from '$lib/server/db/schema';
import { computeMetrics } from '$lib/server/badges';
import { BADGES } from '$lib/badges';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;

	const [metrics, earned] = await Promise.all([
		computeMetrics(userId),
		db
			.select({
				badgeKey: userBadges.badgeKey,
				tier: userBadges.tier,
				earnedAt: userBadges.earnedAt
			})
			.from(userBadges)
			.where(eq(userBadges.userId, userId))
	]);

	const earnedMap = new Map(earned.map((e) => [e.badgeKey, e]));

	// Merge the static registry with the user's earned tiers + current metric so
	// the wall can show earned badges, progress, and locked ones in one pass.
	const badges = BADGES.map((def) => {
		const e = earnedMap.get(def.key);
		return {
			key: def.key,
			title: def.title,
			description: def.description,
			emoji: def.emoji,
			metric: def.metric,
			thresholds: def.thresholds,
			value: metrics[def.metric],
			earnedTier: e?.tier ?? null,
			earnedAt: e?.earnedAt ?? null
		};
	});

	return { badges, earnedCount: earned.length, totalCount: BADGES.length };
};
