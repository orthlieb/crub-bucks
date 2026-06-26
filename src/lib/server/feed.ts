import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from './db';
import {
	bets,
	betParticipants,
	ledgerEntries,
	wallets,
	users,
	userBadges,
	sportMarkets,
	sportWagers
} from './db/schema';
import type { BadgeTier } from '$lib/badges';

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
	avatarIcon: string | null;
	/**
	 * Status ring for this person's avatar within an item. Only the `people`
	 * arrays set it: green/red for resolved winners/losers, red for the canceller.
	 * Created bets and payments leave it unset (no ring).
	 */
	ring?: 'green' | 'yellow' | 'red' | null;
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
			icon: string | null;
			amount: number | null;
			creator: FeedUser;
			participants: FeedUser[];
			people: FeedUser[];
	  }
	| {
			id: string;
			type: 'bet_resolved';
			at: Date;
			betId: string;
			title: string;
			icon: string | null;
			amount: number | null;
			winners: FeedPerson[];
			losers: FeedPerson[];
			note: string | null;
			people: FeedUser[];
	  }
	| {
			id: string;
			type: 'bet_cancelled';
			at: Date;
			betId: string;
			title: string;
			icon: string | null;
			amount: number | null;
			cancelledBy: FeedUser;
			people: FeedUser[];
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
			people: FeedUser[];
	  }
	| {
			id: string;
			type: 'badge_earned';
			at: Date;
			badgeKey: string;
			tier: BadgeTier;
			earner: FeedUser;
			people: FeedUser[];
	  }
	| {
			id: string;
			type: 'sports_settled';
			at: Date;
			marketId: string;
			league: string;
			leagueLogo: string | null;
			homeName: string;
			homeAbbr: string;
			homeLogo: string | null;
			awayName: string;
			awayAbbr: string;
			awayLogo: string | null;
			/** Final result; 'draw' (or a void) is a push — no winners/losers. */
			winningSide: 'home' | 'away' | 'draw' | null;
			push: boolean;
			winners: FeedPerson[];
			losers: FeedPerson[];
			people: FeedUser[];
	  };

/**
 * Build an activity feed. `audience` is the set of user ids whose activity is
 * visible to the viewer — typically the viewer plus their accepted friends (a
 * friends feed), or just the viewer ("Just me"). Pass the literal `'all'` for a
 * global feed; that path is admin-only (the friends feed never uses it). An
 * item is included when at least one of its people is in the audience.
 */
export async function getFeed(opts: {
	limit?: number;
	audience: Iterable<string> | 'all';
}): Promise<FeedItem[]> {
	const { limit = 50 } = opts;
	const all = opts.audience === 'all';
	const audience = all
		? null
		: opts.audience instanceof Set
			? opts.audience
			: new Set(opts.audience as Iterable<string>);
	const items: FeedItem[] = [];

	// --- Bets (created + resolved) ----------------------------------------
	const betList = await db
		.select({
			id: bets.id,
			title: bets.title,
			icon: bets.icon,
			status: bets.status,
			pool: bets.pool,
			createdAt: bets.createdAt,
			resolvedAt: bets.resolvedAt,
			resolutionNote: bets.resolutionNote,
			cancelledAt: bets.cancelledAt,
			cancelledBy: bets.cancelledBy,
			creatorId: bets.createdBy,
			creatorName: users.displayName,
			creatorAvatarUpdatedAt: users.avatarUpdatedAt,
			creatorAvatarIcon: users.avatarIcon
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
				avatarIcon: users.avatarIcon,
				outcome: betParticipants.outcome,
				settledDelta: betParticipants.settledDelta,
				lossIfLose: betParticipants.lossIfLose
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

			// Pending bets aren't public yet — they only surface once accepted
			// (live) or if they get declined (which records a cancellation).
			if (b.status === 'pending') continue;

			// Audience filter: only show bets that involve someone in the audience.
			if (!all && !ps.some((p) => audience!.has(p.userId))) continue;

			// Total wagered: the pot for pooled modes, else the sum of each
			// player's stake (loss-if-lose) for custom bets, which have no pot.
			const amount =
				b.pool != null ? Number(b.pool) : ps.reduce((s, p) => s + Number(p.lossIfLose ?? 0), 0);

			const creator: FeedUser = {
				id: b.creatorId,
				name: b.creatorName,
				avatarUpdatedAt: b.creatorAvatarUpdatedAt,
				avatarIcon: b.creatorAvatarIcon
			};
			const participants: FeedUser[] = ps.map((p) => ({
				id: p.userId,
				name: p.displayName,
				avatarUpdatedAt: p.avatarUpdatedAt,
				avatarIcon: p.avatarIcon
			}));
			// Participant avatars, instigator (creator) first.
			const people: FeedUser[] = [creator, ...participants.filter((p) => p.id !== creator.id)];

			items.push({
				id: `bet_created:${b.id}`,
				type: 'bet_created',
				at: b.createdAt,
				betId: b.id,
				title: b.title,
				icon: b.icon,
				amount,
				creator,
				participants,
				people
			});

			if (b.status === 'resolved' && b.resolvedAt) {
				// Same avatars as the created event, but ringed by outcome.
				const outcomeById = new Map(ps.map((p) => [p.userId, p.outcome]));
				const resolvedPeople: FeedUser[] = people.map((pp) => {
					const o = outcomeById.get(pp.id);
					return { ...pp, ring: o === 'won' ? 'green' : o === 'lost' ? 'red' : null };
				});
				items.push({
					id: `bet_resolved:${b.id}`,
					type: 'bet_resolved',
					at: b.resolvedAt,
					betId: b.id,
					title: b.title,
					icon: b.icon,
					amount,
					people: resolvedPeople,
					winners: ps
						.filter((p) => p.outcome === 'won')
						.map((p) => ({
							id: p.userId,
							name: p.displayName,
							avatarUpdatedAt: p.avatarUpdatedAt,
							avatarIcon: p.avatarIcon,
							amount: Number(p.settledDelta ?? 0)
						})),
					losers: ps
						.filter((p) => p.outcome === 'lost')
						.map((p) => ({
							id: p.userId,
							name: p.displayName,
							avatarUpdatedAt: p.avatarUpdatedAt,
							avatarIcon: p.avatarIcon,
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
							avatarUpdatedAt: cancellerPart.avatarUpdatedAt,
							avatarIcon: cancellerPart.avatarIcon
						}
					: creator;
				// Red ring on whoever called it off; everyone else unringed.
				const cancelledPeople: FeedUser[] = people.map((pp) => ({
					...pp,
					ring: pp.id === b.cancelledBy ? 'red' : null
				}));
				items.push({
					id: `bet_cancelled:${b.id}`,
					type: 'bet_cancelled',
					at: b.cancelledAt ?? b.createdAt,
					betId: b.id,
					title: b.title,
					icon: b.icon,
					amount,
					cancelledBy,
					people: cancelledPeople
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
			userAvatarUpdatedAt: users.avatarUpdatedAt,
			userAvatarIcon: users.avatarIcon
		})
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.leftJoin(users, eq(users.id, wallets.userId))
		// Real friend-to-friend payments only: exclude both bet settlements and
		// sports-market payouts (those get their own feed items).
		.where(and(isNull(ledgerEntries.betId), isNull(ledgerEntries.sportMarketId)))
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
				avatarIcon: string | null;
			}[];
		}
	>();
	for (const r of payRows) {
		const entry = byTransfer.get(r.transferId) ?? {
			createdAt: r.createdAt,
			memo: r.memo,
			icon: r.icon,
			legs: []
		};
		entry.legs.push({
			delta: Number(r.delta),
			kind: r.kind,
			userId: r.userId,
			name: r.userName,
			avatarUpdatedAt: r.userAvatarUpdatedAt,
			avatarIcon: r.userAvatarIcon
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
		// Audience filter: only show payments where someone in the audience is a party.
		if (!all && !audience!.has(fromLeg.userId) && !audience!.has(toLeg.userId)) continue;
		const from: FeedUser = {
			id: fromLeg.userId,
			name: fromLeg.name,
			avatarUpdatedAt: fromLeg.avatarUpdatedAt,
			avatarIcon: fromLeg.avatarIcon
		};
		const to: FeedUser = {
			id: toLeg.userId,
			name: toLeg.name,
			avatarUpdatedAt: toLeg.avatarUpdatedAt,
			avatarIcon: toLeg.avatarIcon
		};
		items.push({
			id: `payment:${transferId}`,
			type: 'payment',
			at: t.createdAt,
			from,
			to,
			amount: Math.abs(fromLeg.delta),
			memo: t.memo,
			icon: t.icon,
			// Instigator (payer) first.
			people: [from, to]
		});
	}

	// --- Badges (recently earned/upgraded) --------------------------------
	const badgeRows = await db
		.select({
			userId: userBadges.userId,
			badgeKey: userBadges.badgeKey,
			tier: userBadges.tier,
			earnedAt: userBadges.earnedAt,
			name: users.displayName,
			avatarUpdatedAt: users.avatarUpdatedAt,
			avatarIcon: users.avatarIcon
		})
		.from(userBadges)
		.innerJoin(users, eq(users.id, userBadges.userId))
		.orderBy(desc(userBadges.earnedAt))
		.limit(100);
	for (const b of badgeRows) {
		// Audience filter: only show badges earned by someone the viewer follows.
		if (!all && !audience!.has(b.userId)) continue;
		const earner: FeedUser = {
			id: b.userId,
			name: b.name,
			avatarUpdatedAt: b.avatarUpdatedAt,
			avatarIcon: b.avatarIcon
		};
		items.push({
			id: `badge:${b.userId}:${b.badgeKey}`,
			type: 'badge_earned',
			at: b.earnedAt,
			badgeKey: b.badgeKey,
			tier: b.tier,
			earner,
			people: [earner]
		});
	}

	// --- Sports market settlements ----------------------------------------
	const marketRows = await db
		.select()
		.from(sportMarkets)
		.where(inArray(sportMarkets.status, ['resolved', 'void']))
		.orderBy(desc(sportMarkets.resolvedAt))
		.limit(100);
	if (marketRows.length > 0) {
		const marketIds = marketRows.map((m) => m.id);
		const wagerRows = await db
			.select({
				marketId: sportWagers.marketId,
				userId: sportWagers.userId,
				settledDelta: sportWagers.settledDelta,
				name: users.displayName,
				avatarUpdatedAt: users.avatarUpdatedAt,
				avatarIcon: users.avatarIcon
			})
			.from(sportWagers)
			.innerJoin(users, eq(users.id, sportWagers.userId))
			.where(inArray(sportWagers.marketId, marketIds));

		const wagersByMarket = new Map<string, typeof wagerRows>();
		for (const w of wagerRows) {
			const arr = wagersByMarket.get(w.marketId) ?? [];
			arr.push(w);
			wagersByMarket.set(w.marketId, arr);
		}

		for (const m of marketRows) {
			const ws = wagersByMarket.get(m.id) ?? [];
			if (ws.length === 0) continue; // nobody wagered — nothing to show
			// Audience filter: only if someone in the audience took part.
			if (!all && !ws.some((w) => audience!.has(w.userId))) continue;

			const push = m.status === 'void' || ws.every((w) => (w.settledDelta ?? 0) === 0);
			const person = (w: (typeof ws)[number], amount: number): FeedPerson => ({
				id: w.userId,
				name: w.name,
				avatarUpdatedAt: w.avatarUpdatedAt,
				avatarIcon: w.avatarIcon,
				amount
			});
			const winners = ws
				.filter((w) => (w.settledDelta ?? 0) > 0)
				.map((w) => person(w, Number(w.settledDelta)));
			const losers = ws
				.filter((w) => (w.settledDelta ?? 0) < 0)
				.map((w) => person(w, Math.abs(Number(w.settledDelta))));
			const people: FeedUser[] = push
				? ws.map((w) => ({
						id: w.userId,
						name: w.name,
						avatarUpdatedAt: w.avatarUpdatedAt,
						avatarIcon: w.avatarIcon
					}))
				: [
						...winners.map((p) => ({ ...p, ring: 'green' as const })),
						...losers.map((p) => ({ ...p, ring: 'red' as const }))
					];

			items.push({
				id: `sports_settled:${m.id}`,
				type: 'sports_settled',
				at: m.resolvedAt ?? m.createdAt,
				marketId: m.id,
				league: m.league,
				leagueLogo: m.leagueLogo,
				homeName: m.homeName,
				homeAbbr: m.homeAbbr,
				homeLogo: m.homeLogo,
				awayName: m.awayName,
				awayAbbr: m.awayAbbr,
				awayLogo: m.awayLogo,
				winningSide: m.winningSide as 'home' | 'away' | 'draw' | null,
				push,
				winners,
				losers,
				people
			});
		}
	}

	// --- Merge, newest first, cap ----------------------------------------
	items.sort((a, b) => b.at.getTime() - a.at.getTime());
	return items.slice(0, limit);
}
