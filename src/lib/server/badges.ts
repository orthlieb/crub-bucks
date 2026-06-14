import { and, count, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from './db';
import {
	userBadges,
	betParticipants,
	bets,
	friendships,
	users,
	ledgerEntries,
	wallets
} from './db/schema';
import { createNotification } from './notifications';
import {
	BADGES,
	tierFor,
	TIER_RANK,
	TIER_LABEL,
	badgeIcon,
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
	// Participation aggregates over the user's resolved bets — computed in the
	// DB (one row back) so we never load the whole history into memory.
	const [agg] = await db
		.select({
			betsJoined: count(),
			betsWon: sql<number>`coalesce(sum(case when ${betParticipants.outcome} = 'won' then 1 else 0 end), 0)`,
			cbWagered: sql<number>`coalesce(sum(abs(${betParticipants.settledDelta})), 0)`,
			maxPot: sql<number>`coalesce(max(${bets.pool}), 0)`
		})
		.from(betParticipants)
		.innerJoin(bets, eq(bets.id, betParticipants.betId))
		.where(and(eq(betParticipants.userId, userId), eq(bets.status, 'resolved')));

	const betsJoined = Number(agg?.betsJoined ?? 0);
	const betsWon = Number(agg?.betsWon ?? 0);
	const cbWagered = Number(agg?.cbWagered ?? 0);
	const maxPot = Number(agg?.maxPot ?? 0);

	// Longest all-time win streak: consecutive 'won' bets in resolution order.
	// Done as a gaps-and-islands window query so it stays bounded (one row out)
	// instead of pulling every resolved bet into JS. The difference of two
	// row_numbers (global vs within-wins) is constant across a run of wins, so
	// grouping by it and taking the largest group size gives the longest streak.
	const streakRes = (await db.execute(sql`
		with ordered as (
			select
				(${betParticipants.outcome} = 'won') as is_win,
				row_number() over (order by ${bets.resolvedAt}, ${bets.id})
					- row_number() over (
						partition by (${betParticipants.outcome} = 'won')
						order by ${bets.resolvedAt}, ${bets.id}
					) as grp
			from ${betParticipants}
			inner join ${bets} on ${bets.id} = ${betParticipants.betId}
			where ${betParticipants.userId} = ${userId} and ${bets.status} = 'resolved'
		)
		select coalesce(max(cnt), 0) as streak
		from (select count(*) as cnt from ordered where is_win group by grp) g
	`)) as unknown as Array<{ streak: number | string }>;
	const winStreak = Number(streakRes[0]?.streak ?? 0);

	// The Dog House: bets this user settled (the resolver), which is independent
	// of participation — counted with its own query.
	const [settled] = await db
		.select({ n: count() })
		.from(bets)
		.where(and(eq(bets.resolvedBy, userId), eq(bets.status, 'resolved')));

	// Social Butterfly: accepted friendships in either direction. Forward-only
	// awarding means a later unfriend can't strip a tier already earned.
	const [friends] = await db
		.select({ n: count() })
		.from(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
			)
		);

	// Throwing Bones: total ₡ sent as peer payments. Sum the debit legs that
	// leave the user's *own* wallet and that the user initiated, excluding
	// bet settlements (betId set) and admin clawbacks (createdBy ≠ self).
	const [sent] = await db
		.select({ total: sql<number>`coalesce(sum(-${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.where(
			and(
				eq(wallets.userId, userId),
				eq(ledgerEntries.createdBy, userId),
				isNull(ledgerEntries.betId),
				lt(ledgerEntries.delta, 0)
			)
		);

	return {
		bets_joined: betsJoined,
		bets_won: betsWon,
		cb_wagered: cbWagered,
		max_pot: maxPot,
		win_streak: winStreak,
		bets_settled: Number(settled?.n ?? 0),
		friends: Number(friends?.n ?? 0),
		cb_sent: Number(sent?.total ?? 0)
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
		// Show the actual per-tier award art (encodes both badge + tier) instead
		// of a medal emoji. The in-app banner falls back if the file is missing.
		const icon = badgeIcon(a.key, a.tier);

		// The earner — celebratory, links to their wall.
		await createNotification({
			userId,
			level: 'success',
			title: `You earned ${tierLabel} “${a.title}”`,
			body: 'Nice — see it on your Awards wall.',
			link: '/app/awards',
			icon
		}).catch(() => {});

		// Each friend — informational, links to the feed where it appears.
		for (const fid of friendIds) {
			await createNotification({
				userId: fid,
				level: 'info',
				title: `${who} earned ${tierLabel} “${a.title}”`,
				link: '/app/feed',
				icon
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
