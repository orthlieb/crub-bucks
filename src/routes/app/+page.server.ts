import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bets, betParticipants } from '$lib/server/db/schema';
import { userBalance, getFriends, getOrCreateUserWallet } from '$lib/server/ledger';
import type { PageServerLoad } from './$types';

const TAGLINES = [
	'No real-world value, all the real-world drama.',
	"For every buck you're up, a friend is down. That's the fun part.",
	'The only currency backed entirely by spite.',
	"Bet responsibly — or don't, it's literally not money.",
	'Going negative has never felt this good.',
	"The bank is bottomless. Your dignity isn't.",
	'Turning friendships into liabilities since today.',
	"Proof money can't buy happiness: this isn't money, and look how happy you are.",
	'Sum of all wallets: zero. Sum of all grudges: climbing.',
	'Monopoly money, but your friends actually hold a grudge.'
];

// Cap settled bets on the dashboard. The Feed (with the "Just me" filter) is
// the canonical place to scroll back through everything — the dashboard only
// surfaces what's recent. Fetch one extra to know whether to show "see more".
const SETTLED_LIMIT = 5;

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const tagline = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];

	// Idempotent — make sure the wallet exists before deriving a balance.
	await getOrCreateUserWallet(userId);

	// Settled bets: order by when they actually finished (resolved or
	// cancelled), falling back to created_at for old rows.
	const finishedAt = sql<Date>`coalesce(${bets.resolvedAt}, ${bets.cancelledAt}, ${bets.createdAt})`;

	const [balance, friends, pendingRows, openRows, settledRows] = await Promise.all([
		userBalance(userId),
		getFriends(userId),
		// Pending bets the user is part of — awaiting acceptance. We also grab
		// this participant's own acceptedAt so the UI can flag "needs your reply".
		db
			.select({
				id: bets.id,
				title: bets.title,
				icon: bets.icon,
				status: bets.status,
				createdAt: bets.createdAt,
				resolvedAt: bets.resolvedAt,
				myAcceptedAt: betParticipants.acceptedAt
			})
			.from(bets)
			.innerJoin(betParticipants, eq(betParticipants.betId, bets.id))
			.where(and(eq(betParticipants.userId, userId), eq(bets.status, 'pending')))
			.orderBy(desc(bets.createdAt)),
		db
			.select({
				id: bets.id,
				title: bets.title,
				icon: bets.icon,
				status: bets.status,
				createdAt: bets.createdAt,
				resolvedAt: bets.resolvedAt
			})
			.from(bets)
			.innerJoin(betParticipants, eq(betParticipants.betId, bets.id))
			.where(and(eq(betParticipants.userId, userId), eq(bets.status, 'open')))
			.orderBy(desc(bets.createdAt)),
		db
			.select({
				id: bets.id,
				title: bets.title,
				icon: bets.icon,
				status: bets.status,
				createdAt: bets.createdAt,
				resolvedAt: bets.resolvedAt
			})
			.from(bets)
			.innerJoin(betParticipants, eq(betParticipants.betId, bets.id))
			.where(
				and(
					eq(betParticipants.userId, userId),
					inArray(bets.status, ['resolved', 'cancelled'])
				)
			)
			.orderBy(desc(finishedAt))
			.limit(SETTLED_LIMIT + 1)
	]);

	const allBetIds = [
		...pendingRows.map((b) => b.id),
		...openRows.map((b) => b.id),
		...settledRows.map((b) => b.id)
	];
	const participantCounts = new Map<string, number>();
	if (allBetIds.length > 0) {
		const partRows = await db
			.select({ betId: betParticipants.betId })
			.from(betParticipants)
			.where(inArray(betParticipants.betId, allBetIds));
		for (const r of partRows) {
			participantCounts.set(r.betId, (participantCounts.get(r.betId) ?? 0) + 1);
		}
	}

	const pendingBets = pendingRows.map((b) => ({
		...b,
		participantCount: participantCounts.get(b.id) ?? 0,
		// Does this bet need the current user to respond?
		needsMyResponse: b.myAcceptedAt === null
	}));
	const openBets = openRows.map((b) => ({
		...b,
		participantCount: participantCounts.get(b.id) ?? 0
	}));
	const hasMoreSettled = settledRows.length > SETTLED_LIMIT;
	const settledBets = settledRows.slice(0, SETTLED_LIMIT).map((b) => ({
		...b,
		participantCount: participantCounts.get(b.id) ?? 0
	}));

	return {
		tagline,
		balance,
		friends,
		pendingBets,
		openBets,
		settledBets,
		hasMoreSettled
	};
};
