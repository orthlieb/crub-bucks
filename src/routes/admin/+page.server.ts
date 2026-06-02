import { count, gt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users, sessions, securityEvents } from '$lib/server/db/schema';
import { getStats } from '$lib/server/stats';
import { getSystemConfig } from '$lib/server/auth/system-config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [
		[userTotal],
		[verifiedTotal],
		[activeSessionsTotal],
		[failures24h],
		systemCfg,
		globalStats
	] = await Promise.all([
		db.select({ n: count() }).from(users),
		db
			.select({ n: count() })
			.from(users)
			.where(sql`${users.emailVerifiedAt} is not null`),
		db.select({ n: count() }).from(sessions).where(gt(sessions.expiresAt, new Date())),
		db
			.select({ n: count() })
			.from(securityEvents)
			.where(
				sql`${securityEvents.eventType} = 'login_failure' and ${securityEvents.createdAt} > now() - interval '24 hours'`
			),
		getSystemConfig(),
		// Maintained counters — O(1) instead of scanning bets / the whole ledger.
		getStats()
	]);

	return {
		stats: {
			users: Number(userTotal?.n ?? 0),
			verifiedUsers: Number(verifiedTotal?.n ?? 0),
			activeSessions: Number(activeSessionsTotal?.n ?? 0),
			failedLogins24h: Number(failures24h?.n ?? 0),
			openBets: globalStats.betsOpen,
			resolvedBets: globalStats.betsResolved,
			wagered: globalStats.bucksWagered,
			bankBalance: globalStats.bankTotal
		},
		system: systemCfg
	};
};
