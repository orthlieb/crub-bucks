/**
 * One-off badge backfill — re-derives every user's badges from resolved-bet
 * history and awards them SILENTLY (no notification storm). Run once after the
 * badges feature ships, and any time thresholds change.
 *
 *   node --import tsx scripts/backfill-badges.ts          # dev (.env)
 *   node --env-file=.env.test --import tsx scripts/backfill-badges.ts
 *
 * Standalone connection + pure imports so it runs under tsx (no $lib/$env),
 * mirroring src/lib/server/db/{seed,migrate}.ts. The award logic mirrors
 * evaluateBadges() in src/lib/server/badges.ts — keep them in sync.
 */
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';
import { BADGES, tierFor, TIER_RANK, type MetricKey } from '../src/lib/badges';

const { users, bets, betParticipants, userBadges } = schema;

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is required');
	const sql = postgres(url);
	const db = drizzle(sql, { schema });

	const allUsers = await db.select({ id: users.id }).from(users);
	let awards = 0;

	for (const u of allUsers) {
		const rows = await db
			.select({ outcome: betParticipants.outcome, settledDelta: betParticipants.settledDelta })
			.from(betParticipants)
			.innerJoin(bets, eq(bets.id, betParticipants.betId))
			.where(and(eq(betParticipants.userId, u.id), eq(bets.status, 'resolved')));

		let joined = 0;
		let won = 0;
		let wagered = 0;
		for (const r of rows) {
			joined += 1;
			if (r.outcome === 'won') won += 1;
			wagered += Math.abs(Number(r.settledDelta ?? 0));
		}
		const metrics: Record<MetricKey, number> = {
			bets_joined: joined,
			bets_won: won,
			cb_wagered: wagered
		};

		const existing = await db
			.select({ badgeKey: userBadges.badgeKey, tier: userBadges.tier })
			.from(userBadges)
			.where(eq(userBadges.userId, u.id));
		const have = new Map(existing.map((e) => [e.badgeKey, e.tier]));

		for (const def of BADGES) {
			const desired = tierFor(def, metrics[def.metric]);
			if (!desired) continue;
			const cur = have.get(def.key);
			if (cur && TIER_RANK[cur] >= TIER_RANK[desired]) continue;
			await db
				.insert(userBadges)
				.values({
					userId: u.id,
					badgeKey: def.key,
					tier: desired,
					metricValue: metrics[def.metric]
				})
				.onConflictDoUpdate({
					target: [userBadges.userId, userBadges.badgeKey],
					set: { tier: desired, earnedAt: new Date(), metricValue: metrics[def.metric] }
				});
			awards += 1;
		}
	}

	console.log(`Backfilled ${allUsers.length} users, ${awards} awards.`);
	await sql.end();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
