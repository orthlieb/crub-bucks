import { and, count, desc, eq, or } from 'drizzle-orm';
import { db } from './db';
import { userBadges, betParticipants, bets, friendships, users } from './db/schema';
import { createNotification } from './notifications';
import {
	BADGES,
	tierFor,
	TIER_RANK,
	TIER_LABEL,
	TIER_EMOJI,
	type BadgeTier,
	type MetricKey
} from '$lib/badges';

/**
 * Badge awarding. Evaluates a user's lifetime metrics against the registry and
 * upgrades badges forward-only (bronze → silver → gold). Best-effort: callers
 * wrap this so a failure never rolls back the bet/payment that triggered it.
 *
 * Most metrics derive from the user's resolved-bet participation (one query);
 * bets_settled (The Dog House) counts bets they resolved, via a second query.
 */

export async function computeMetrics(userId: string): Promise<Record<MetricKey, number>> {
	const rows = await db
		.select({
			outcome: betParticipants.outcome,
			settledDelta: betParticipants.settledDelta,
			pool: bets.pool,
			resolvedAt: bets.resolvedAt
		})
		.from(betParticipants)
		.innerJoin(bets, eq(bets.id, betParticipants.betId))
		.where(and(eq(betParticipants.userId, userId), eq(bets.status, 'resolved')));

	let betsJoined = 0;
	let betsWon = 0;
	let cbWagered = 0;
	let maxPot = 0;
	for (const r of rows) {
		betsJoined += 1;
		if (r.outcome === 'won') betsWon += 1;
		cbWagered += Math.abs(Number(r.settledDelta ?? 0));
		maxPot = Math.max(maxPot, Number(r.pool ?? 0));
	}

	// Longest win streak: walk resolved bets in resolution order; a non-win
	// (lost / none) breaks the run. All-time best, so it never decreases.
	let cur = 0;
	let winStreak = 0;
	for (const r of [...rows].sort(
		(a, b) => (a.resolvedAt?.getTime() ?? 0) - (b.resolvedAt?.getTime() ?? 0)
	)) {
		if (r.outcome === 'won') {
			cur += 1;
			if (cur > winStreak) winStreak = cur;
		} else {
			cur = 0;
		}
	}

	// The Dog House: bets this user settled (the resolver), which is independent
	// of participation — counted with its own query.
	const [settled] = await db
		.select({ n: count() })
		.from(bets)
		.where(and(eq(bets.resolvedBy, userId), eq(bets.status, 'resolved')));

	return {
		bets_joined: betsJoined,
		bets_won: betsWon,
		cb_wagered: cbWagered,
		max_pot: maxPot,
		win_streak: winStreak,
		bets_settled: Number(settled?.n ?? 0)
	};
}

/** Accepted-friend user ids (either direction), for notification fan-out. */
async function acceptedFriendIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ requesterId: friendships.requesterId, addresseeId: friendships.addresseeId })
		.from(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
			)
		);
	return rows.map((r) => (r.requesterId === userId ? r.addresseeId : r.requesterId));
}

interface AwardedBadge {
	key: string;
	title: string;
	emoji: string;
	tier: BadgeTier;
}

/**
 * Evaluate one user, award any newly earned/upgraded tiers, and (unless silent)
 * notify the earner and their friends. Idempotent — re-running awards nothing
 * new. Pass `{ silent: true }` for backfills so history doesn't replay.
 */
export async function evaluateBadges(
	userId: string,
	opts: { silent?: boolean } = {}
): Promise<AwardedBadge[]> {
	const metrics = await computeMetrics(userId);

	const existing = await db
		.select({ badgeKey: userBadges.badgeKey, tier: userBadges.tier })
		.from(userBadges)
		.where(eq(userBadges.userId, userId));
	const haveTier = new Map<string, BadgeTier>(existing.map((e) => [e.badgeKey, e.tier]));

	const awarded: AwardedBadge[] = [];
	for (const def of BADGES) {
		const value = metrics[def.metric];
		const desired = tierFor(def, value);
		if (!desired) continue;
		const have = haveTier.get(def.key);
		// Forward-only: skip if we're already at or above the desired tier.
		if (have && TIER_RANK[have] >= TIER_RANK[desired]) continue;

		await db
			.insert(userBadges)
			.values({ userId, badgeKey: def.key, tier: desired, metricValue: value })
			.onConflictDoUpdate({
				target: [userBadges.userId, userBadges.badgeKey],
				set: { tier: desired, earnedAt: new Date(), metricValue: value }
			});
		awarded.push({ key: def.key, title: def.title, emoji: def.emoji, tier: desired });
	}

	if (awarded.length > 0 && !opts.silent) {
		await notifyAwards(userId, awarded).catch((err) =>
			console.warn('[badges] notify failed:', err)
		);
	}
	return awarded;
}

async function notifyAwards(userId: string, awarded: AwardedBadge[]): Promise<void> {
	const [me] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	const who = me?.displayName ?? 'Someone';
	const friendIds = await acceptedFriendIds(userId);

	for (const a of awarded) {
		const tierLabel = TIER_LABEL[a.tier];
		const emoji = TIER_EMOJI[a.tier];

		// The earner — celebratory, links to their wall.
		await createNotification({
			userId,
			level: 'success',
			title: `${emoji} You earned ${tierLabel} “${a.title}”`,
			body: 'Nice — see it on your Awards wall.',
			link: '/app/awards'
		}).catch(() => {});

		// Each friend — informational, links to the feed where it appears.
		for (const fid of friendIds) {
			await createNotification({
				userId: fid,
				level: 'info',
				title: `${emoji} ${who} earned ${tierLabel} “${a.title}”`,
				link: '/app/feed'
			}).catch(() => {});
		}
	}
}

/**
 * Timestamp of the user's most recently earned/upgraded badge, or null. Drives
 * the "wow" sound cue (the client plays it once when this value advances).
 */
export async function latestBadgeAt(userId: string): Promise<Date | null> {
	const [row] = await db
		.select({ earnedAt: userBadges.earnedAt })
		.from(userBadges)
		.where(eq(userBadges.userId, userId))
		.orderBy(desc(userBadges.earnedAt))
		.limit(1);
	return row?.earnedAt ?? null;
}

/**
 * Backfill: re-derive every user's badges from history, silently (no
 * notification storm). Safe to run anytime — awarding is idempotent.
 */
export async function recomputeBadges(): Promise<{ users: number; awards: number }> {
	const ids = await db.select({ id: users.id }).from(users);
	let awards = 0;
	for (const u of ids) {
		const got = await evaluateBadges(u.id, { silent: true });
		awards += got.length;
	}
	return { users: ids.length, awards };
}
