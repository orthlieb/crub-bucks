import { desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db';
import { bets, betParticipants, ledgerEntries, wallets, users } from './db/schema';

/**
 * Public activity feed, visible to all logged-in users (Venmo-style).
 * It's *derived* from existing data — no separate events table. Three event
 * kinds, merged and sorted newest-first:
 *
 *   - bet_created   : someone started a bet (lists participants)
 *   - bet_resolved  : a bet settled (winners + losers, with amounts; supports
 *                     multiple winners for team games)
 *   - bet_cancelled : a bet was called off before resolving
 *   - payment       : a direct friend-to-friend transfer (betId null, both
 *                     legs are user wallets — excludes the bank welcome grant)
 *
 * Amounts are included. The render layer builds the sentence from these
 * structured fields.
 */

/** A person referenced in the feed, carrying what the <Avatar> needs. */
export interface FeedUser {
	id: string;
	name: string;
	avatarUpdatedAt: Date | null;
}

/** A feed person with an associated amount (bet winners / losers). */
export interface FeedPerson extends FeedUser {
	amount: number;
}

export type FeedItem =
	| {
			id: string;
			type: 'bet_created';
			at: Date;
			betId: string;
			title: string;
			creator: FeedUser;
			participants: FeedUser[];
	  }
	| {
			id: string;
			type: 'bet_resolved';
			at: Date;
			betId: string;
			title: string;
			winners: FeedPerson[];
			losers: FeedPerson[];
			note: string | null;
	  }
	| {
			id: string;
			type: 'bet_cancelled';
			at: Date;
			betId: string;
			title: string;
			cancelledBy: FeedUser;
	  }
	| {
			id: string;
			type: 'payment';
			at: Date;
			from: FeedUser;
			to: FeedUser;
			amount: number;
			memo: string | null;
			icon: string | null;
	  };

export async function getFeed(opts: { limit?: number; userId?: string } = {}): Promise<FeedItem[]> {
	const { limit = 50, userId } = opts;
	const items: FeedItem[] = [];

	// --- Bets (created + resolved) ----------------------------------------
	const betList = await db
		.select({
			id: bets.id,
			title: bets.title,
			status: bets.status,
			createdAt: bets.createdAt,
			resolvedAt: bets.resolvedAt,
			resolutionNote: bets.resolutionNote,
			cancelledAt: bets.cancelledAt,
			cancelledBy: bets.cancelledBy,
			creatorId: bets.createdBy,
			creatorName: users.displayName,
			creatorAvatarUpdatedAt: users.avatarUpdatedAt
		})
		.from(bets)
		.innerJoin(users, eq(users.id, bets.createdBy))
		.orderBy(desc(bets.createdAt))
		.limit(100);

	if (betList.length > 0) {
		const betIds = betList.map((b) => b.id);
		const parts = await db
			.select({
				betId: betParticipants.betId,
				userId: betParticipants.userId,
				displayName: users.displayName,
				avatarUpdatedAt: users.avatarUpdatedAt,
				outcome: betParticipants.outcome,
				settledDelta: betParticipants.settledDelta
			})
			.from(betParticipants)
			.innerJoin(users, eq(users.id, betParticipants.userId))
			.where(inArray(betParticipants.betId, betIds));

		const partsByBet = new Map<string, typeof parts>();
		for (const p of parts) {
			const arr = partsByBet.get(p.betId) ?? [];
			arr.push(p);
			partsByBet.set(p.betId, arr);
		}

		for (const b of betList) {
			const ps = partsByBet.get(b.id) ?? [];

			// "Mine" filter: skip bets the user isn't part of.
			if (userId && !ps.some((p) => p.userId === userId)) continue;

			const creator: FeedUser = {
				id: b.creatorId,
				name: b.creatorName,
				avatarUpdatedAt: b.creatorAvatarUpdatedAt
			};

			items.push({
				id: `bet_created:${b.id}`,
				type: 'bet_created',
				at: b.createdAt,
				betId: b.id,
				title: b.title,
				creator,
				participants: ps.map((p) => ({
					id: p.userId,
					name: p.displayName,
					avatarUpdatedAt: p.avatarUpdatedAt
				}))
			});

			if (b.status === 'resolved' && b.resolvedAt) {
				items.push({
					id: `bet_resolved:${b.id}`,
					type: 'bet_resolved',
					at: b.resolvedAt,
					betId: b.id,
					title: b.title,
					winners: ps
						.filter((p) => p.outcome === 'won')
						.map((p) => ({
							id: p.userId,
							name: p.displayName,
							avatarUpdatedAt: p.avatarUpdatedAt,
							amount: Number(p.settledDelta ?? 0)
						})),
					losers: ps
						.filter((p) => p.outcome === 'lost')
						.map((p) => ({
							id: p.userId,
							name: p.displayName,
							avatarUpdatedAt: p.avatarUpdatedAt,
							amount: Math.abs(Number(p.settledDelta ?? 0))
						})),
					note: b.resolutionNote
				});
			}

			if (b.status === 'cancelled') {
				// Fall back to createdAt for rows cancelled before cancelledAt existed.
				const cancellerPart = ps.find((p) => p.userId === b.cancelledBy);
				const cancelledBy: FeedUser = cancellerPart
					? {
							id: cancellerPart.userId,
							name: cancellerPart.displayName,
							avatarUpdatedAt: cancellerPart.avatarUpdatedAt
						}
					: creator;
				items.push({
					id: `bet_cancelled:${b.id}`,
					type: 'bet_cancelled',
					at: b.cancelledAt ?? b.createdAt,
					betId: b.id,
					title: b.title,
					cancelledBy
				});
			}
		}
	}

	// --- Payments (peer transfers, betId null, both legs user wallets) ----
	const payRows = await db
		.select({
			transferId: ledgerEntries.transferId,
			createdAt: ledgerEntries.createdAt,
			delta: ledgerEntries.delta,
			memo: ledgerEntries.memo,
			icon: ledgerEntries.icon,
			kind: wallets.kind,
			userId: users.id,
			userName: users.displayName,
			userAvatarUpdatedAt: users.avatarUpdatedAt
		})
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.leftJoin(users, eq(users.id, wallets.userId))
		.where(isNull(ledgerEntries.betId))
		.orderBy(desc(ledgerEntries.createdAt))
		.limit(400);

	const byTransfer = new Map<
		string,
		{
			createdAt: Date;
			memo: string | null;
			icon: string | null;
			legs: {
				delta: number;
				kind: string;
				userId: string | null;
				name: string | null;
				avatarUpdatedAt: Date | null;
			}[];
		}
	>();
	for (const r of payRows) {
		const entry =
			byTransfer.get(r.transferId) ??
			{ createdAt: r.createdAt, memo: r.memo, icon: r.icon, legs: [] };
		entry.legs.push({
			delta: Number(r.delta),
			kind: r.kind,
			userId: r.userId,
			name: r.userName,
			avatarUpdatedAt: r.userAvatarUpdatedAt
		});
		byTransfer.set(r.transferId, entry);
	}

	for (const [transferId, t] of byTransfer) {
		if (t.legs.length !== 2) continue;
		// Exclude any transfer involving the bank (e.g. the welcome grant).
		if (t.legs.some((l) => l.kind !== 'user')) continue;
		const fromLeg = t.legs.find((l) => l.delta < 0);
		const toLeg = t.legs.find((l) => l.delta > 0);
		if (!fromLeg || !toLeg || !fromLeg.name || !toLeg.name || !fromLeg.userId || !toLeg.userId)
			continue;
		// "Mine" filter: skip payments the user isn't part of.
		if (userId && fromLeg.userId !== userId && toLeg.userId !== userId) continue;
		items.push({
			id: `payment:${transferId}`,
			type: 'payment',
			at: t.createdAt,
			from: { id: fromLeg.userId, name: fromLeg.name, avatarUpdatedAt: fromLeg.avatarUpdatedAt },
			to: { id: toLeg.userId, name: toLeg.name, avatarUpdatedAt: toLeg.avatarUpdatedAt },
			amount: Math.abs(fromLeg.delta),
			memo: t.memo,
			icon: t.icon
		});
	}

	// --- Merge, newest first, cap ----------------------------------------
	items.sort((a, b) => b.at.getTime() - a.at.getTime());
	return items.slice(0, limit);
}
