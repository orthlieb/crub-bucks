import { eq, and, sql, desc, asc, ne, inArray, or, isNull } from 'drizzle-orm';
import { db } from './db';
import {
	wallets,
	ledgerEntries,
	bets,
	betParticipants,
	friendships,
	friendInvites,
	friendFavorites,
	users
} from './db/schema';
import { sendFriendInviteEmail } from './email';
import { createNotification } from './notifications';
import { evaluateBadges } from './badges';
import { bumpStats } from './stats';
import {
	planSettlement,
	evenSplitDeltas,
	winnerLoserDeltas,
	tieredDeltas,
	potSplitDeltas,
	oddsDeltas,
	BetMathError,
	type BetMode,
	type ParticipantDelta
} from '../ledger-math';

/**
 * The ledger: every economic event in Crub Bucks is a transfer of a positive
 * amount from one wallet to another. Each transfer writes exactly two ledger
 * rows whose deltas sum to zero, inside a single DB transaction. Because of
 * this, the sum of all wallet balances across the system is invariantly zero
 * — the welcome grant from the bank, peer payments, and bet resolutions all
 * use this one primitive.
 *
 * Wallets are global: one wallet per user, plus a single system-wide Bank
 * wallet. `ledger_entries.bet_id` is *context* (set on transfers produced by
 * bet resolution) — it does not partition the zero-sum invariant.
 */

export class LedgerError extends Error {}

const WELCOME_GRANT_CB = 100;

/** Max accepted friends per user (abuse limit). Pending/invites don't count. */
export const MAX_FRIENDS = 99;
const FRIEND_CAP_MESSAGE = "You can't have any more friends.";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

// ---------------------------------------------------------------------------
// Wallet lookup / provisioning
// ---------------------------------------------------------------------------

export async function getOrCreateBankWallet(tx: DbOrTx = db): Promise<string> {
	const [existing] = await tx
		.select({ id: wallets.id })
		.from(wallets)
		.where(eq(wallets.kind, 'bank'))
		.limit(1);
	if (existing) return existing.id;

	try {
		const [created] = await tx
			.insert(wallets)
			.values({ kind: 'bank', userId: null })
			.returning({ id: wallets.id });
		return created.id;
	} catch {
		const [after] = await tx
			.select({ id: wallets.id })
			.from(wallets)
			.where(eq(wallets.kind, 'bank'))
			.limit(1);
		if (!after) throw new LedgerError('Bank wallet could not be resolved');
		return after.id;
	}
}

export async function getOrCreateUserWallet(userId: string, tx: DbOrTx = db): Promise<string> {
	const [existing] = await tx
		.select({ id: wallets.id })
		.from(wallets)
		.where(and(eq(wallets.userId, userId), eq(wallets.kind, 'user')))
		.limit(1);
	if (existing) return existing.id;

	try {
		const [created] = await tx
			.insert(wallets)
			.values({ kind: 'user', userId })
			.returning({ id: wallets.id });
		return created.id;
	} catch {
		const [after] = await tx
			.select({ id: wallets.id })
			.from(wallets)
			.where(and(eq(wallets.userId, userId), eq(wallets.kind, 'user')))
			.limit(1);
		if (!after) throw new LedgerError(`User ${userId} wallet could not be resolved`);
		return after.id;
	}
}

// ---------------------------------------------------------------------------
// Transfer primitive
// ---------------------------------------------------------------------------

export interface TransferOpts {
	fromWalletId: string;
	toWalletId: string;
	amount: number;
	memo?: string | null;
	/** Single-grapheme emoji ("🍕", "🎁"). Stamped on both ledger legs. */
	icon?: string | null;
	createdBy?: string | null;
	/** Optional context — the bet whose resolution produced this transfer. */
	betId?: string | null;
}

async function transferInTx(tx: DbOrTx, opts: TransferOpts): Promise<string> {
	const {
		fromWalletId,
		toWalletId,
		amount,
		memo = null,
		icon = null,
		createdBy = null,
		betId = null
	} = opts;

	if (!Number.isInteger(amount) || amount <= 0) {
		throw new LedgerError('Amount must be a positive whole number of Crub Bucks');
	}
	if (fromWalletId === toWalletId) {
		throw new LedgerError('Cannot transfer to the same wallet');
	}

	const ws = await tx
		.select({ id: wallets.id, kind: wallets.kind })
		.from(wallets)
		.where(inArray(wallets.id, [fromWalletId, toWalletId]));
	if (ws.length !== 2) {
		throw new LedgerError('Both wallets must exist');
	}

	const transferId = crypto.randomUUID();
	await tx.insert(ledgerEntries).values([
		{ transferId, walletId: fromWalletId, delta: -amount, memo, icon, createdBy, betId },
		{ transferId, walletId: toWalletId, delta: amount, memo, icon, createdBy, betId }
	]);

	// Keep the Bank-total stat current: this transfer's net effect on the Bank
	// wallet (single source of truth — every transfer flows through here). At
	// most one leg is the Bank.
	const fromBank = ws.find((w) => w.id === fromWalletId)?.kind === 'bank';
	const toBank = ws.find((w) => w.id === toWalletId)?.kind === 'bank';
	if (fromBank) await bumpStats(tx, { bankTotal: -amount });
	else if (toBank) await bumpStats(tx, { bankTotal: amount });

	return transferId;
}

export async function transfer(opts: TransferOpts): Promise<string> {
	return db.transaction((tx) => transferInTx(tx, opts));
}

/**
 * Transfer from one user's wallet to another's. Auto-creates either wallet if
 * it doesn't exist yet (first-touch provisioning).
 */
export async function transferBetweenUsers(opts: {
	fromUserId: string;
	toUserId: string;
	amount: number;
	memo?: string | null;
	icon?: string | null;
	createdBy?: string | null;
}): Promise<string> {
	const transferId = await db.transaction(async (tx) => {
		const fromWalletId = await getOrCreateUserWallet(opts.fromUserId, tx);
		const toWalletId = await getOrCreateUserWallet(opts.toUserId, tx);
		return transferInTx(tx, {
			fromWalletId,
			toWalletId,
			amount: opts.amount,
			memo: opts.memo ?? null,
			icon: opts.icon ?? null,
			createdBy: opts.createdBy ?? opts.fromUserId
		});
	});

	// Tell the recipient they got paid (best-effort).
	const [payer] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, opts.fromUserId))
		.limit(1);
	await createNotification({
		userId: opts.toUserId,
		level: 'success',
		title: `${payer?.displayName ?? 'Someone'} paid you ${opts.amount} ₡`,
		body: opts.memo ? `“${opts.memo}”` : null,
		link: '/app/feed'
	}).catch(() => {});

	// The payer just spent → re-evaluate Throwing Bones. Best-effort.
	await evaluateBadges(opts.fromUserId).catch((err) => console.warn('[badges] eval failed:', err));

	return transferId;
}

/** Issue bucks from the Bank to a user's wallet. */
export async function issueFromBank(opts: {
	toUserId: string;
	amount: number;
	memo?: string | null;
	createdBy?: string | null;
	tx?: DbOrTx;
}): Promise<string> {
	const run = async (tx: DbOrTx) => {
		const bankWalletId = await getOrCreateBankWallet(tx);
		const toWalletId = await getOrCreateUserWallet(opts.toUserId, tx);
		return transferInTx(tx, {
			fromWalletId: bankWalletId,
			toWalletId,
			amount: opts.amount,
			memo: opts.memo ?? 'Bank issuance',
			createdBy: opts.createdBy ?? null
		});
	};
	return opts.tx ? run(opts.tx) : db.transaction(run);
}

/**
 * Admin override: set a user's balance to an exact whole number by moving the
 * difference to/from the Bank, so the system stays zero-sum (the Bank absorbs
 * the adjustment). Returns the previous and new balances.
 */
export async function adminSetBalance(opts: {
	adminId: string;
	userId: string;
	target: number;
}): Promise<{ previous: number; next: number; delta: number }> {
	const { adminId, userId, target } = opts;
	if (!Number.isInteger(target)) throw new LedgerError('Balance must be a whole number');
	return db.transaction(async (tx) => {
		const userWalletId = await getOrCreateUserWallet(userId, tx);
		const [row] = await tx
			.select({ balance: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
			.from(ledgerEntries)
			.where(eq(ledgerEntries.walletId, userWalletId));
		const previous = Number(row?.balance ?? 0);
		const delta = target - previous;
		if (delta !== 0) {
			const bankWalletId = await getOrCreateBankWallet(tx);
			await transferInTx(tx, {
				fromWalletId: delta > 0 ? bankWalletId : userWalletId,
				toWalletId: delta > 0 ? userWalletId : bankWalletId,
				amount: Math.abs(delta),
				memo: 'Admin balance adjustment',
				createdBy: adminId
			});
		}
		return { previous, next: target, delta };
	});
}

/** Balances for a specific set of users (page-scoped — admin user lists). */
export async function userBalancesFor(userIds: string[]): Promise<Map<string, number>> {
	const m = new Map<string, number>();
	if (userIds.length === 0) return m;
	const rows = await db
		.select({
			userId: wallets.userId,
			balance: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)`
		})
		.from(wallets)
		.leftJoin(ledgerEntries, eq(ledgerEntries.walletId, wallets.id))
		.where(and(eq(wallets.kind, 'user'), inArray(wallets.userId, userIds)))
		.groupBy(wallets.userId);
	for (const r of rows) if (r.userId) m.set(r.userId, Number(r.balance ?? 0));
	return m;
}

// ---------------------------------------------------------------------------
// First-login welcome grant
// ---------------------------------------------------------------------------

/**
 * Grant the 100 CB welcome bonus, exactly once per user. Guarded by a
 * conditional UPDATE on users.welcome_granted_at: only the row that flips it
 * from NULL proceeds to issue the grant, so concurrent logins can't double up.
 */
export async function grantWelcomeIfNeeded(userId: string): Promise<boolean> {
	const granted = await db.transaction(async (tx) => {
		const updated = await tx
			.update(users)
			.set({ welcomeGrantedAt: new Date() })
			.where(and(eq(users.id, userId), sql`${users.welcomeGrantedAt} is null`))
			.returning({ id: users.id });
		if (updated.length === 0) return false; // already granted (or no such user)

		await issueFromBank({
			toUserId: userId,
			amount: WELCOME_GRANT_CB,
			memo: 'Welcome grant',
			createdBy: null,
			tx
		});
		return true;
	});

	if (granted) {
		// Pop a notification on the user's first dashboard visit so they
		// understand where the 100 ₡ came from. Outside the txn so a failure
		// here can't roll back the grant itself.
		await createNotification({
			userId,
			level: 'success',
			title: `Welcome to Crub Bucks! The Bank gave you ${WELCOME_GRANT_CB} ₡ to get started.`,
			body: 'Add a friend, start a bet, and remember: this is not real money. The drama, however, is.'
		}).catch(() => {
			// Non-fatal: the grant already landed.
		});
	}

	return granted;
}

// ---------------------------------------------------------------------------
// Balance derivation
// ---------------------------------------------------------------------------

export async function walletBalance(walletId: string): Promise<number> {
	const [row] = await db
		.select({ balance: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries)
		.where(eq(ledgerEntries.walletId, walletId));
	return Number(row?.balance ?? 0);
}

export async function userBalance(userId: string): Promise<number> {
	const [row] = await db
		.select({ balance: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.where(and(eq(wallets.userId, userId), eq(wallets.kind, 'user')));
	return Number(row?.balance ?? 0);
}

export interface AccountEntry {
	id: string;
	delta: number;
	memo: string | null;
	icon: string | null;
	betId: string | null;
	betTitle: string | null;
	/** The other side of the transfer: a friend's name or "The Bank". */
	counterparty: string;
	createdAt: Date;
	/** This wallet's running balance immediately after this entry. */
	balanceAfter: number;
}

/**
 * A user's personal account statement — every ledger entry against their
 * wallet (newest first), each annotated with the counterparty, any bet
 * context, and the running balance at that point. Like a bank statement.
 *
 * The running balance is computed over the full history (ascending) so it's
 * accurate even when we only return the most recent `limit` rows.
 */
export async function getAccountStatement(userId: string, limit = 200): Promise<AccountEntry[]> {
	const walletId = await getOrCreateUserWallet(userId);

	const mine = await db
		.select({
			id: ledgerEntries.id,
			transferId: ledgerEntries.transferId,
			delta: ledgerEntries.delta,
			memo: ledgerEntries.memo,
			icon: ledgerEntries.icon,
			betId: ledgerEntries.betId,
			createdAt: ledgerEntries.createdAt
		})
		.from(ledgerEntries)
		.where(eq(ledgerEntries.walletId, walletId))
		.orderBy(asc(ledgerEntries.createdAt), asc(ledgerEntries.id));

	// Counterparty = the other leg of each transfer (every transfer has exactly two).
	const transferIds = mine.map((m) => m.transferId);
	const counterpartyByTransfer = new Map<string, string>();
	if (transferIds.length) {
		const others = await db
			.select({
				transferId: ledgerEntries.transferId,
				kind: wallets.kind,
				displayName: users.displayName
			})
			.from(ledgerEntries)
			.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
			.leftJoin(users, eq(users.id, wallets.userId))
			.where(
				and(inArray(ledgerEntries.transferId, transferIds), ne(ledgerEntries.walletId, walletId))
			);
		for (const o of others) {
			counterpartyByTransfer.set(
				o.transferId,
				o.kind === 'bank' ? 'The Bank' : (o.displayName ?? 'Someone')
			);
		}
	}

	// Bet titles for context links.
	const betIds = [...new Set(mine.map((m) => m.betId).filter((b): b is string => !!b))];
	const betTitleById = new Map<string, string>();
	if (betIds.length) {
		const titles = await db
			.select({ id: bets.id, title: bets.title })
			.from(bets)
			.where(inArray(bets.id, betIds));
		for (const b of titles) betTitleById.set(b.id, b.title);
	}

	let running = 0;
	const rows = mine.map((m) => {
		running += Number(m.delta);
		return {
			id: m.id,
			delta: Number(m.delta),
			memo: m.memo,
			icon: m.icon,
			betId: m.betId,
			betTitle: m.betId ? (betTitleById.get(m.betId) ?? null) : null,
			counterparty: counterpartyByTransfer.get(m.transferId) ?? 'Someone',
			createdAt: m.createdAt,
			balanceAfter: running
		};
	});
	rows.reverse(); // newest first for display
	return rows.slice(0, limit);
}

export async function bankBalance(): Promise<number> {
	const [row] = await db
		.select({ balance: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.where(eq(wallets.kind, 'bank'));
	return Number(row?.balance ?? 0);
}

// ---------------------------------------------------------------------------
// Activity feed (per user)
// ---------------------------------------------------------------------------

export interface ActivityEntry {
	transferId: string;
	delta: number; // signed, from the perspective of the queried user's wallet
	memo: string | null;
	betId: string | null;
	createdAt: Date;
}

/**
 * Recent transfers touching a user's wallet, newest first. Each row's delta is
 * signed from the user's perspective (negative = paid out, positive = received).
 */
export async function userActivity(userId: string, limit = 50): Promise<ActivityEntry[]> {
	const rows = await db
		.select({
			transferId: ledgerEntries.transferId,
			delta: ledgerEntries.delta,
			memo: ledgerEntries.memo,
			betId: ledgerEntries.betId,
			createdAt: ledgerEntries.createdAt
		})
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.where(and(eq(wallets.userId, userId), eq(wallets.kind, 'user')))
		.orderBy(desc(ledgerEntries.createdAt))
		.limit(limit);

	return rows.map((r) => ({
		transferId: r.transferId,
		delta: Number(r.delta),
		memo: r.memo,
		betId: r.betId,
		createdAt: r.createdAt
	}));
}

/**
 * Most-recent "went live" and "cancelled" timestamps across the bets this user
 * is part of. Drives the bet on/off sound cues — the client compares each
 * against the last value it saw. Both null when the user has no such bets.
 */
export async function betSoundSignals(
	userId: string
): Promise<{ lastLiveAt: Date | null; lastCancelledAt: Date | null }> {
	const [row] = await db
		.select({
			lastLiveAt: sql<Date | null>`max(${bets.wentLiveAt})`,
			lastCancelledAt: sql<Date | null>`max(${bets.cancelledAt})`
		})
		.from(bets)
		.innerJoin(betParticipants, eq(betParticipants.betId, bets.id))
		.where(eq(betParticipants.userId, userId));
	return {
		lastLiveAt: row?.lastLiveAt ?? null,
		lastCancelledAt: row?.lastCancelledAt ?? null
	};
}

// ---------------------------------------------------------------------------
// Integrity guard
// ---------------------------------------------------------------------------

export async function assertZeroSum(): Promise<boolean> {
	const [row] = await db
		.select({ total: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries);
	return Number(row?.total ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// Friendships (request → accept handshake)
// One canonical row per relationship. Either party can be the requester, so
// "are they friends" and "unfriend" check/affect BOTH directions.
// ---------------------------------------------------------------------------

/** Accepted friendship between a and b, in either direction. */
/** Count of a user's accepted friends (either direction). */
export async function countAcceptedFriends(userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
			)
		);
	return Number(row?.n ?? 0);
}

export async function areFriends(a: string, b: string): Promise<boolean> {
	const [row] = await db
		.select({ id: friendships.id })
		.from(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(
					and(eq(friendships.requesterId, a), eq(friendships.addresseeId, b)),
					and(eq(friendships.requesterId, b), eq(friendships.addresseeId, a))
				)
			)
		)
		.limit(1);
	return !!row;
}

/** Accepted friends of a user (the other party in each accepted row). */
export async function getFriends(userId: string): Promise<
	Array<{
		id: string;
		displayName: string;
		email: string;
		since: Date | null;
		isFavorite: boolean;
		avatarUpdatedAt: Date | null;
		avatarIcon: string | null;
	}>
> {
	// LEFT JOIN to friend_favorites so we can sort favorites first without a
	// separate query. The "other side" of each friendship is computed once via
	// the CASE expression and reused for both the user join and the favorite
	// join (so the favorite is keyed to *the friend's* id, not the caller's).
	const otherId = sql<string>`case when ${friendships.requesterId} = ${userId} then ${friendships.addresseeId} else ${friendships.requesterId} end`;
	const rows = await db
		.select({
			respondedAt: friendships.respondedAt,
			otherId,
			displayName: users.displayName,
			email: users.email,
			avatarUpdatedAt: users.avatarUpdatedAt,
			avatarIcon: users.avatarIcon,
			favoritedAt: friendFavorites.createdAt
		})
		.from(friendships)
		.innerJoin(users, sql`${users.id} = ${otherId}`)
		.leftJoin(
			friendFavorites,
			and(eq(friendFavorites.userId, userId), sql`${friendFavorites.friendId} = ${otherId}`)
		)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
			)
		)
		// Favorites first (NULLS LAST puts non-favorites after), then
		// alphabetical within each group.
		.orderBy(sql`${friendFavorites.createdAt} IS NULL`, users.displayName);

	return rows.map((r) => ({
		id: r.otherId,
		displayName: r.displayName,
		email: r.email,
		since: r.respondedAt,
		isFavorite: r.favoritedAt !== null,
		avatarUpdatedAt: r.avatarUpdatedAt,
		avatarIcon: r.avatarIcon
	}));
}

/**
 * Toggle the favorite flag on a friend for the calling user. Idempotent on
 * both sides — calling with isFavorite=true twice is a no-op. Verifies the
 * friendship is accepted before allowing the favorite (you can't pin a
 * stranger).
 */
export async function setFavorite(
	userId: string,
	friendId: string,
	isFavorite: boolean
): Promise<void> {
	if (userId === friendId) throw new LedgerError("You can't favorite yourself");
	if (!(await areFriends(userId, friendId))) {
		throw new LedgerError('You can only favorite your friends');
	}
	if (isFavorite) {
		await db.insert(friendFavorites).values({ userId, friendId }).onConflictDoNothing();
	} else {
		await db
			.delete(friendFavorites)
			.where(and(eq(friendFavorites.userId, userId), eq(friendFavorites.friendId, friendId)));
	}
}

/** Pending requests sent TO this user (awaiting their approval). */
export async function getIncomingRequests(
	userId: string
): Promise<
	Array<{ requestId: string; fromId: string; displayName: string; email: string; sentAt: Date }>
> {
	const rows = await db
		.select({
			requestId: friendships.id,
			fromId: friendships.requesterId,
			displayName: users.displayName,
			email: users.email,
			sentAt: friendships.createdAt
		})
		.from(friendships)
		.innerJoin(users, eq(users.id, friendships.requesterId))
		.where(and(eq(friendships.addresseeId, userId), eq(friendships.status, 'pending')))
		.orderBy(desc(friendships.createdAt));
	return rows;
}

/** Pending requests this user has sent (awaiting the other's approval). */
export async function getOutgoingRequests(
	userId: string
): Promise<
	Array<{ requestId: string; toId: string; displayName: string; email: string; sentAt: Date }>
> {
	const rows = await db
		.select({
			requestId: friendships.id,
			toId: friendships.addresseeId,
			displayName: users.displayName,
			email: users.email,
			sentAt: friendships.createdAt
		})
		.from(friendships)
		.innerJoin(users, eq(users.id, friendships.addresseeId))
		.where(and(eq(friendships.requesterId, userId), eq(friendships.status, 'pending')))
		.orderBy(desc(friendships.createdAt));
	return rows;
}

export async function countIncomingRequests(userId: string): Promise<number> {
	const [row] = await db
		.select({ n: sql<number>`count(*)` })
		.from(friendships)
		.where(and(eq(friendships.addresseeId, userId), eq(friendships.status, 'pending')));
	return Number(row?.n ?? 0);
}

/**
 * Send a friend request by email. Behaviour:
 *   - error on self
 *   - if the email isn't a user yet → record an invite + email them to join
 *     ('invited' / 'already_invited')
 *   - if already accepted (either direction) → no-op ('already')
 *   - if a request from ME→THEM is pending → no-op ('already_sent')
 *   - if a request from THEM→ME is pending → accept it ('accepted')
 *   - otherwise insert a new pending row ('sent')
 */
export async function sendFriendRequest(
	requesterId: string,
	email: string,
	options: { deliver?: 'email' | 'link' } = {}
): Promise<{
	result: 'sent' | 'accepted' | 'already' | 'already_sent' | 'invited' | 'already_invited';
	otherId?: string;
	/** Present for invite results — lets the caller build a shareable link. */
	inviteId?: string;
}> {
	const normalized = email.trim().toLowerCase();
	if (!normalized) throw new LedgerError('Enter an email address.');

	const [other] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, normalized))
		.limit(1);

	// Not a user yet → invite flow.
	if (!other) {
		const [me] = await db
			.select({ email: users.email, displayName: users.displayName })
			.from(users)
			.where(eq(users.id, requesterId))
			.limit(1);
		if (me && me.email === normalized) throw new LedgerError("You can't add yourself.");

		const [existingInvite] = await db
			.select({ id: friendInvites.id, claimedAt: friendInvites.claimedAt })
			.from(friendInvites)
			.where(and(eq(friendInvites.inviterId, requesterId), eq(friendInvites.email, normalized)))
			.limit(1);
		if (existingInvite && !existingInvite.claimedAt) {
			return { result: 'already_invited', inviteId: existingInvite.id };
		}

		if ((await countAcceptedFriends(requesterId)) >= MAX_FRIENDS) {
			throw new LedgerError(FRIEND_CAP_MESSAGE);
		}

		let inviteId = existingInvite?.id;
		if (!inviteId) {
			const [created] = await db
				.insert(friendInvites)
				.values({ inviterId: requesterId, email: normalized })
				.returning({ id: friendInvites.id });
			inviteId = created.id;
		}
		// When the caller will deliver the link themselves (e.g. via text), skip
		// the automatic email — the invite row still ties signup back to them.
		if (options.deliver !== 'link') {
			try {
				await sendFriendInviteEmail({
					to: normalized,
					inviterName: me?.displayName ?? 'A friend',
					inviteId
				});
			} catch (err) {
				console.warn('[friend-invite] failed to send invite email:', err);
			}
		}
		return { result: 'invited', inviteId };
	}

	if (other.id === requesterId) throw new LedgerError("You can't add yourself.");

	const existing = await db
		.select({
			id: friendships.id,
			requesterId: friendships.requesterId,
			addresseeId: friendships.addresseeId,
			status: friendships.status
		})
		.from(friendships)
		.where(
			or(
				and(eq(friendships.requesterId, requesterId), eq(friendships.addresseeId, other.id)),
				and(eq(friendships.requesterId, other.id), eq(friendships.addresseeId, requesterId))
			)
		);

	const accepted = existing.find((r) => r.status === 'accepted');
	if (accepted) return { result: 'already', otherId: other.id };

	const minePending = existing.find((r) => r.status === 'pending' && r.requesterId === requesterId);
	if (minePending) return { result: 'already_sent', otherId: other.id };

	// About to create or enable a friendship — both sides must be under cap.
	if ((await countAcceptedFriends(requesterId)) >= MAX_FRIENDS) {
		throw new LedgerError(FRIEND_CAP_MESSAGE);
	}
	// If the person you're adding is already full, tell you now rather than
	// letting a request sit that they could never accept.
	if ((await countAcceptedFriends(other.id)) >= MAX_FRIENDS) {
		throw new LedgerError(FRIEND_CAP_MESSAGE);
	}

	const [requester] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, requesterId))
		.limit(1);
	const requesterName = requester?.displayName ?? 'Someone';

	const theirsPending = existing.find((r) => r.status === 'pending' && r.requesterId === other.id);
	if (theirsPending) {
		// They already asked us — accept their request (mutual intent).
		await db
			.update(friendships)
			.set({ status: 'accepted', respondedAt: new Date() })
			.where(eq(friendships.id, theirsPending.id));
		await createNotification({
			userId: other.id,
			level: 'success',
			title: `${requesterName} accepted your friend request`,
			body: "You're now friends — start a bet or send some bucks.",
			link: '/app/friends'
		}).catch(() => {});
		return { result: 'accepted', otherId: other.id };
	}

	await db.insert(friendships).values({ requesterId, addresseeId: other.id, status: 'pending' });
	await createNotification({
		userId: other.id,
		level: 'info',
		title: `${requesterName} sent you a friend request`,
		body: 'Open Friends to accept or deny.',
		link: '/app/friends'
	}).catch(() => {});
	return { result: 'sent', otherId: other.id };
}

/** Accept a pending request. Only the addressee may accept. Both parties must
 * be under the friend cap. */
export async function acceptFriendRequest(userId: string, requestId: string): Promise<void> {
	const [req] = await db
		.select({ id: friendships.id, requesterId: friendships.requesterId })
		.from(friendships)
		.where(
			and(
				eq(friendships.id, requestId),
				eq(friendships.addresseeId, userId),
				eq(friendships.status, 'pending')
			)
		)
		.limit(1);
	if (!req) throw new LedgerError('Request not found.');

	if ((await countAcceptedFriends(userId)) >= MAX_FRIENDS) {
		throw new LedgerError(FRIEND_CAP_MESSAGE);
	}
	if ((await countAcceptedFriends(req.requesterId)) >= MAX_FRIENDS) {
		throw new LedgerError(FRIEND_CAP_MESSAGE);
	}

	await db
		.update(friendships)
		.set({ status: 'accepted', respondedAt: new Date() })
		.where(eq(friendships.id, req.id));

	// Let the original requester know their request was accepted.
	const [accepter] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	await createNotification({
		userId: req.requesterId,
		level: 'success',
		title: `${accepter?.displayName ?? 'Someone'} accepted your friend request`,
		body: "You're now friends — start a bet or send some bucks.",
		link: '/app/friends'
	}).catch(() => {});

	// Both sides just gained a friend → re-evaluate Social Butterfly. Best-effort.
	for (const uid of [userId, req.requesterId]) {
		await evaluateBadges(uid).catch((err) => console.warn('[badges] eval failed:', err));
	}
}

/** Deny a pending request. Only the addressee may deny (row is deleted). */
export async function denyFriendRequest(userId: string, requestId: string): Promise<void> {
	await db
		.delete(friendships)
		.where(
			and(
				eq(friendships.id, requestId),
				eq(friendships.addresseeId, userId),
				eq(friendships.status, 'pending')
			)
		);
}

/** Cancel a pending request you sent. Only the requester may cancel. */
export async function cancelFriendRequest(userId: string, requestId: string): Promise<void> {
	await db
		.delete(friendships)
		.where(
			and(
				eq(friendships.id, requestId),
				eq(friendships.requesterId, userId),
				eq(friendships.status, 'pending')
			)
		);
}

/** Remove an accepted friendship (either direction). */
export async function unfriend(userId: string, otherId: string): Promise<void> {
	await db
		.delete(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(
					and(eq(friendships.requesterId, userId), eq(friendships.addresseeId, otherId)),
					and(eq(friendships.requesterId, otherId), eq(friendships.addresseeId, userId))
				)
			)
		);
}

// ---------------------------------------------------------------------------
// Friend invites (to non-users)
// ---------------------------------------------------------------------------

/** Outstanding (unclaimed) invites this user has sent to non-users. */
export async function getPendingInvites(
	inviterId: string
): Promise<Array<{ id: string; email: string; sentAt: Date }>> {
	return db
		.select({ id: friendInvites.id, email: friendInvites.email, sentAt: friendInvites.createdAt })
		.from(friendInvites)
		.where(and(eq(friendInvites.inviterId, inviterId), isNull(friendInvites.claimedAt)))
		.orderBy(desc(friendInvites.createdAt));
}

/** Cancel an outstanding invite. Only the inviter may cancel, only if unclaimed. */
export async function cancelInvite(inviterId: string, inviteId: string): Promise<void> {
	await db
		.delete(friendInvites)
		.where(
			and(
				eq(friendInvites.id, inviteId),
				eq(friendInvites.inviterId, inviterId),
				isNull(friendInvites.claimedAt)
			)
		);
}

/**
 * When a new user registers, turn any unclaimed invites to their email into
 * pending friend requests (requester = inviter → addressee = new user). The
 * handshake still applies: the new user approves/denies on first login.
 * Self-invites and duplicates are ignored.
 */
export async function materializeInvitesForUser(email: string, newUserId: string): Promise<void> {
	const normalized = email.trim().toLowerCase();
	const invites = await db
		.select({ id: friendInvites.id, inviterId: friendInvites.inviterId })
		.from(friendInvites)
		.where(and(eq(friendInvites.email, normalized), isNull(friendInvites.claimedAt)));
	if (invites.length === 0) return;

	for (const inv of invites) {
		if (inv.inviterId !== newUserId) {
			await db
				.insert(friendships)
				.values({ requesterId: inv.inviterId, addresseeId: newUserId, status: 'pending' })
				.onConflictDoNothing();
		}
		await db
			.update(friendInvites)
			.set({ claimedAt: new Date(), claimedUserId: newUserId })
			.where(eq(friendInvites.id, inv.id));
	}
}

/**
 * Claim a single invite by its id — used when a new user follows an invite
 * link but registers with a *different* email than the one invited. The invite
 * id in the link ties the two together. Materializes the same inviter→new-user
 * pending request. No-op if the invite is unknown, already claimed, or a
 * self-invite.
 */
export async function materializeInviteById(inviteId: string, newUserId: string): Promise<void> {
	const [inv] = await db
		.select({
			id: friendInvites.id,
			inviterId: friendInvites.inviterId,
			claimedAt: friendInvites.claimedAt
		})
		.from(friendInvites)
		.where(eq(friendInvites.id, inviteId))
		.limit(1);
	if (!inv || inv.claimedAt || inv.inviterId === newUserId) return;

	await db
		.insert(friendships)
		.values({ requesterId: inv.inviterId, addresseeId: newUserId, status: 'pending' })
		.onConflictDoNothing();
	await db
		.update(friendInvites)
		.set({ claimedAt: new Date(), claimedUserId: newUserId })
		.where(eq(friendInvites.id, inv.id));
}

/** Set of accepted-friend user ids for a user (used by createBet). */
async function acceptedFriendIds(userId: string): Promise<Set<string>> {
	const rows = await db
		.select({
			requesterId: friendships.requesterId,
			addresseeId: friendships.addresseeId
		})
		.from(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
			)
		);
	const ids = new Set<string>();
	for (const r of rows) ids.add(r.requesterId === userId ? r.addresseeId : r.requesterId);
	return ids;
}

// ---------------------------------------------------------------------------
// Bets
// ---------------------------------------------------------------------------

export interface BetParticipantInput {
	userId: string;
	payoutIfWin: number;
	lossIfLose: number;
}

/**
 * Create a standalone bet. Common validation: non-empty title, >= 2 unique
 * participants, the creator is among them, and every other participant is an
 * accepted friend of the creator.
 *
 * Pooled modes (even_split / winner_loser / tiered) take a positive `pool`
 * (the pot the winner takes) and just a list of participant ids — the per-
 * person amounts are computed at resolution. Custom mode takes explicit
 * payout/loss per participant (positive integers), as before.
 */
export async function createBet(opts: {
	mode: BetMode;
	title: string;
	/** Single-grapheme emoji like "🎲". Optional — display has a fallback. */
	icon?: string | null;
	createdBy: string;
	pool?: number | null;
	/** 'pot' mode only: the equal per-player buy-in. */
	stake?: number | null;
	participantIds?: string[];
	participants?: BetParticipantInput[];
}): Promise<string> {
	const { mode, title, icon = null, createdBy } = opts;
	if (!title.trim()) throw new LedgerError('Bet title is required');

	let ids: string[];
	let pool: number | null = null;
	let stake: number | null = null;

	if (mode === 'custom') {
		const ps = opts.participants ?? [];
		if (ps.length < 2) throw new LedgerError('A bet needs at least 2 participants');
		for (const p of ps) {
			if (!Number.isInteger(p.payoutIfWin) || p.payoutIfWin <= 0) {
				throw new LedgerError('payoutIfWin must be a positive whole number');
			}
			if (!Number.isInteger(p.lossIfLose) || p.lossIfLose <= 0) {
				throw new LedgerError('lossIfLose must be a positive whole number');
			}
		}
		ids = ps.map((p) => p.userId);
	} else if (mode === 'pot') {
		ids = opts.participantIds ?? [];
		if (ids.length < 2) throw new LedgerError('A bet needs at least 2 participants');
		stake = opts.stake ?? 0;
		if (!Number.isInteger(stake) || stake <= 0) {
			throw new LedgerError('Enter a positive whole buy-in amount');
		}
		pool = stake * ids.length;
	} else if (mode === 'odds') {
		// Each participant picks their own wager: the creator sets theirs now
		// (stored as boughtIn); invited players set theirs when they accept. The
		// pot is dynamic (Σ boughtIn) so `pool` stays null until resolution.
		ids = opts.participantIds ?? [];
		if (ids.length < 2) throw new LedgerError('A bet needs at least 2 participants');
		stake = opts.stake ?? 0;
		if (!Number.isInteger(stake) || stake <= 0) {
			throw new LedgerError('Enter your wager as a positive whole number');
		}
	} else {
		ids = opts.participantIds ?? [];
		if (ids.length < 2) throw new LedgerError('A bet needs at least 2 participants');
		pool = opts.pool ?? 0;
		if (!Number.isInteger(pool) || pool <= 0) {
			throw new LedgerError('Enter a positive whole wager amount');
		}
	}

	if (new Set(ids).size !== ids.length) {
		throw new LedgerError('Each participant may only appear once');
	}
	if (!ids.includes(createdBy)) {
		throw new LedgerError('You must be one of the participants');
	}

	const others = ids.filter((u) => u !== createdBy);
	if (others.length > 0) {
		const friendSet = await acceptedFriendIds(createdBy);
		const stranger = others.find((u) => !friendSet.has(u));
		if (stranger) throw new LedgerError('You can only add your friends to a bet.');
	}

	// Bets start as 'pending': the creator is auto-accepted, everyone else is
	// invited and must accept before the bet goes live (status 'open').
	const now = new Date();
	const acceptedAtFor = (uid: string) => (uid === createdBy ? now : null);

	const betId = await db.transaction(async (tx) => {
		const [bet] = await tx
			.insert(bets)
			.values({
				title: title.trim(),
				icon,
				createdBy,
				status: 'pending',
				mode,
				pool,
				stake
			})
			.returning({ id: bets.id });

		const rows =
			mode === 'custom'
				? opts.participants!.map((p) => ({
						betId: bet.id,
						userId: p.userId,
						payoutIfWin: p.payoutIfWin,
						lossIfLose: p.lossIfLose,
						outcome: 'pending' as const,
						acceptedAt: acceptedAtFor(p.userId)
					}))
				: mode === 'pot'
					? ids.map((id) => ({
							betId: bet.id,
							userId: id,
							outcome: 'pending' as const,
							boughtIn: stake!,
							acceptedAt: acceptedAtFor(id)
						}))
					: mode === 'odds'
						? ids.map((id) => ({
								betId: bet.id,
								userId: id,
								outcome: 'pending' as const,
								// Creator's wager is known now; others set theirs on accept.
								boughtIn: id === createdBy ? stake! : null,
								acceptedAt: acceptedAtFor(id)
							}))
						: ids.map((id) => ({
								betId: bet.id,
								userId: id,
								outcome: 'pending' as const,
								acceptedAt: acceptedAtFor(id)
							}));
		await tx.insert(betParticipants).values(rows);
		return bet.id;
	});

	// Ping each invited participant to accept or decline. Best-effort — a failed
	// notification shouldn't undo a created bet.
	if (others.length > 0) {
		const [creator] = await db
			.select({ displayName: users.displayName })
			.from(users)
			.where(eq(users.id, createdBy))
			.limit(1);
		const who = creator?.displayName ?? 'A friend';
		for (const uid of others) {
			await createNotification({
				level: 'info',
				title: `${who} invited you to a bet`,
				body: `"${title.trim()}" — open it to accept or decline.`,
				link: `/app/bet/${betId}`,
				userId: uid
			}).catch(() => {});
		}
	}

	return betId;
}

/**
 * A participant accepts a pending bet. When the last outstanding invitee
 * accepts, the bet flips to 'open' (live). Idempotent: re-accepting is a no-op.
 * Returns whether this acceptance made the bet go live, plus the creator/title
 * so the caller can notify.
 */
export async function acceptBet(opts: {
	betId: string;
	userId: string;
	/** 'odds' mode only: the accepting player's self-chosen wager. */
	stake?: number | null;
}): Promise<{ wentLive: boolean; createdBy: string; title: string }> {
	const { betId, userId } = opts;
	const result = await db.transaction(async (tx) => {
		// Lock the bet row so concurrent accepts on the same bet serialize —
		// otherwise two simultaneous accepts could each miss the other's
		// not-yet-committed acceptance and leave a fully-accepted bet stuck.
		const [bet] = await tx
			.select({
				status: bets.status,
				createdBy: bets.createdBy,
				title: bets.title,
				mode: bets.mode
			})
			.from(bets)
			.where(eq(bets.id, betId))
			.limit(1)
			.for('update');
		if (!bet) throw new LedgerError('Bet not found');
		if (bet.status !== 'pending') throw new LedgerError(`Bet is already ${bet.status}`);

		const [part] = await tx
			.select({ acceptedAt: betParticipants.acceptedAt })
			.from(betParticipants)
			.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, userId)))
			.limit(1);
		if (!part) throw new LedgerError("You're not a participant in this bet");

		// Odds bets: accepting means declaring your wager (stored as boughtIn).
		let boughtIn: number | undefined;
		if (bet.mode === 'odds') {
			const s = opts.stake;
			if (!Number.isInteger(s) || (s as number) < 1) {
				throw new LedgerError('Enter your wager as a positive whole number to accept.');
			}
			boughtIn = s as number;
		}

		if (!part.acceptedAt) {
			await tx
				.update(betParticipants)
				.set({ acceptedAt: new Date(), ...(boughtIn !== undefined ? { boughtIn } : {}) })
				.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, userId)));
		}

		const [remaining] = await tx
			.select({ n: sql<number>`count(*)::int` })
			.from(betParticipants)
			.where(and(eq(betParticipants.betId, betId), isNull(betParticipants.acceptedAt)));

		const wentLive = Number(remaining?.n ?? 0) === 0;
		if (wentLive) {
			await tx
				.update(bets)
				.set({ status: 'open', wentLiveAt: new Date() })
				.where(eq(bets.id, betId));
			await bumpStats(tx, { betsOpen: 1 });
		}
		return { wentLive, createdBy: bet.createdBy, title: bet.title };
	});

	// Let the creator know their bet is live.
	if (result.wentLive) {
		await createNotification({
			level: 'success',
			title: 'Your bet is live',
			body: `Everyone accepted "${result.title}". Time to play.`,
			link: `/app/bet/${betId}`,
			userId: result.createdBy
		}).catch(() => {});
	}
	return result;
}

/**
 * A participant declines a pending bet, which calls the whole thing off
 * (status 'cancelled', cancelledBy = the decliner). Returns the creator/title
 * so the caller can notify.
 */
export async function declineBet(opts: {
	betId: string;
	userId: string;
}): Promise<{ createdBy: string; title: string }> {
	const { betId, userId } = opts;
	const result = await db.transaction(async (tx) => {
		// Lock the bet row so a decline and a concurrent accept can't race.
		const [bet] = await tx
			.select({ status: bets.status, createdBy: bets.createdBy, title: bets.title })
			.from(bets)
			.where(eq(bets.id, betId))
			.limit(1)
			.for('update');
		if (!bet) throw new LedgerError('Bet not found');
		if (bet.status !== 'pending') throw new LedgerError(`Bet is already ${bet.status}`);

		const [part] = await tx
			.select({ userId: betParticipants.userId })
			.from(betParticipants)
			.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, userId)))
			.limit(1);
		if (!part) throw new LedgerError("You're not a participant in this bet");

		await tx
			.update(bets)
			.set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy: userId })
			.where(eq(bets.id, betId));
		return { createdBy: bet.createdBy, title: bet.title };
	});

	// Tell the creator their bet was called off (unless they're the decliner).
	if (result.createdBy !== userId) {
		await createNotification({
			level: 'warning',
			title: 'A bet was declined',
			body: `"${result.title}" was called off because someone declined.`,
			link: `/app/bet/${betId}`,
			userId: result.createdBy
		}).catch(() => {});
	}
	return result;
}

/**
 * Re-buy: a participant adds more to a 'pot' bet's pool. Self-only — the
 * `requestedBy` user must equal the participant userId. Bumps that participant's
 * bought_in and the bet's pool atomically. No CB moves until resolution.
 */
export async function rebuy(opts: {
	betId: string;
	userId: string;
	amount: number;
	requestedBy: string;
}): Promise<void> {
	const { betId, userId, amount, requestedBy } = opts;
	if (!Number.isInteger(amount) || amount <= 0) {
		throw new LedgerError('Re-buy amount must be a positive whole number');
	}
	if (userId !== requestedBy) {
		throw new LedgerError('You can only record a re-buy for yourself');
	}

	await db.transaction(async (tx) => {
		const [bet] = await tx
			.select({ status: bets.status, mode: bets.mode, pool: bets.pool })
			.from(bets)
			.where(eq(bets.id, betId))
			.limit(1);
		if (!bet) throw new LedgerError('Bet not found');
		if (bet.mode !== 'pot') throw new LedgerError('Re-buys only apply to pot bets');
		if (bet.status !== 'open') throw new LedgerError(`Bet is already ${bet.status}`);

		const [part] = await tx
			.select({ boughtIn: betParticipants.boughtIn })
			.from(betParticipants)
			.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, userId)))
			.limit(1);
		if (!part) throw new LedgerError("You're not a participant in this bet");

		await tx
			.update(betParticipants)
			.set({ boughtIn: Number(part.boughtIn ?? 0) + amount })
			.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, userId)));

		await tx
			.update(bets)
			.set({ pool: Number(bet.pool ?? 0) + amount })
			.where(eq(bets.id, betId));
	});
}

/**
 * Resolve a bet. The selection depends on the bet's mode:
 *   - custom:       `outcomes` map of userId → 'won' | 'lost' (must balance)
 *   - even_split:   `winnerId` (everyone else splits the pool equally)
 *   - winner_loser: `winnerId` + `loserId` (others net zero)
 *   - tiered:       `winnerId` + `loserOrder` (least→most), shares by rank
 *
 * Either way it computes signed deltas summing to zero, writes the
 * loser→winner transfers, records each participant's outcome / settled delta
 * (and loss rank for tiered), and marks the bet resolved.
 */
export async function resolveBet(opts: {
	betId: string;
	resolvedBy: string;
	note?: string | null;
	outcomes?: Record<string, 'won' | 'lost'>;
	winnerId?: string;
	loserId?: string;
	loserOrder?: string[];
	/** 'pot' mode: per-participant final winnings (must sum to the pool). */
	winnings?: Record<string, number>;
	/** Tie-split escape hatch (any mode): per-participant net delta; must sum to
	 *  0. Requires a note. Lets a tie be settled by hand without changing stakes. */
	manual?: Record<string, number>;
}): Promise<{ transferIds: string[] }> {
	const { betId, resolvedBy } = opts;
	const note = opts.note?.trim() || null;

	const result = await db.transaction(async (tx) => {
		const [bet] = await tx
			.select({
				id: bets.id,
				status: bets.status,
				title: bets.title,
				mode: bets.mode,
				pool: bets.pool
			})
			.from(bets)
			.where(eq(bets.id, betId))
			.limit(1);
		if (!bet) throw new LedgerError('Bet not found');
		if (bet.status !== 'open') throw new LedgerError(`Bet is already ${bet.status}`);

		const parts = await tx
			.select({
				userId: betParticipants.userId,
				payoutIfWin: betParticipants.payoutIfWin,
				lossIfLose: betParticipants.lossIfLose,
				boughtIn: betParticipants.boughtIn
			})
			.from(betParticipants)
			.where(eq(betParticipants.betId, betId));
		if (parts.length === 0) throw new LedgerError('Bet has no participants');

		const partIds = new Set(parts.map((p) => p.userId));
		const nonWinner = (winnerId: string) =>
			parts.map((p) => p.userId).filter((u) => u !== winnerId);

		let deltas: ParticipantDelta[];
		const lossRankByUser = new Map<string, number>();

		if (opts.manual) {
			// Tie-split: the resolver sets each participant's net result directly.
			// Mode-agnostic; must balance to zero, move exactly the original pot
			// (no inventing or shrinking stakes), and carry a note for the record.
			if (!note) throw new LedgerError('Add a note explaining the split.');
			const manual = opts.manual;
			deltas = parts.map((p) => ({
				userId: p.userId,
				delta: Math.trunc(Number(manual[p.userId] ?? 0))
			}));
			for (const d of deltas) {
				if (!Number.isFinite(d.delta))
					throw new LedgerError('Enter a whole number for each player.');
			}
			const sum = deltas.reduce((s, d) => s + d.delta, 0);
			if (sum !== 0) {
				throw new LedgerError('The split must balance to zero — winnings must equal losses.');
			}
			const won = deltas.reduce((s, d) => s + (d.delta > 0 ? d.delta : 0), 0);
			const pool = Number(bet.pool ?? 0);
			if (won !== pool) {
				throw new LedgerError(
					`The winnings must total the ${pool} ₡ pot (you distributed ${won} ₡). For an all-tie wash where no one pays, cancel the bet instead.`
				);
			}
		} else if (bet.mode === 'custom') {
			const outcomes = opts.outcomes ?? {};
			for (const p of parts) {
				if (!(p.userId in outcomes)) {
					throw new LedgerError('Mark won or lost for every participant');
				}
			}
			const winners: ParticipantDelta[] = [];
			const losers: ParticipantDelta[] = [];
			for (const p of parts) {
				const o = outcomes[p.userId];
				if (o === 'won') winners.push({ userId: p.userId, delta: Number(p.payoutIfWin) });
				else if (o === 'lost') losers.push({ userId: p.userId, delta: -Number(p.lossIfLose) });
				else throw new LedgerError(`Outcome for ${p.userId} must be 'won' or 'lost'`);
			}
			if (winners.length === 0 || losers.length === 0) {
				throw new LedgerError('A resolution must have at least one winner and one loser');
			}
			const winSum = winners.reduce((s, w) => s + w.delta, 0);
			const loseSum = -losers.reduce((s, l) => s + l.delta, 0);
			if (winSum !== loseSum) {
				throw new LedgerError(
					`Bet does not balance: winners would receive ${winSum}, losers would pay ${loseSum}`
				);
			}
			deltas = [...winners, ...losers];
		} else if (bet.mode === 'pot') {
			const winnings = opts.winnings ?? {};
			for (const p of parts) {
				if (!(p.userId in winnings)) {
					throw new LedgerError('Enter winnings for every participant');
				}
			}
			try {
				deltas = potSplitDeltas(
					parts.map((p) => ({
						userId: p.userId,
						boughtIn: Number(p.boughtIn ?? 0),
						winnings: Number(winnings[p.userId])
					}))
				);
			} catch (e) {
				if (e instanceof BetMathError) throw new LedgerError(e.message);
				throw e;
			}
		} else if (bet.mode === 'odds') {
			// Single winner takes the pot; each loser pays their own wager.
			const winnerId = opts.winnerId;
			if (!winnerId || !partIds.has(winnerId)) throw new LedgerError('Pick a valid winner');
			try {
				deltas = oddsDeltas(
					parts.map((p) => ({ userId: p.userId, stake: Number(p.boughtIn ?? 0) })),
					winnerId
				);
			} catch (e) {
				if (e instanceof BetMathError) throw new LedgerError(e.message);
				throw e;
			}
		} else {
			const pool = Number(bet.pool ?? 0);
			const winnerId = opts.winnerId;
			if (!winnerId || !partIds.has(winnerId)) throw new LedgerError('Pick a valid winner');

			if (bet.mode === 'even_split') {
				deltas = evenSplitDeltas(pool, winnerId, nonWinner(winnerId));
			} else if (bet.mode === 'winner_loser') {
				const loserId = opts.loserId;
				if (!loserId || !partIds.has(loserId) || loserId === winnerId) {
					throw new LedgerError('Pick a valid loser');
				}
				const zeros = parts.map((p) => p.userId).filter((u) => u !== winnerId && u !== loserId);
				deltas = winnerLoserDeltas(pool, winnerId, loserId, zeros);
			} else {
				// tiered
				const order = opts.loserOrder ?? [];
				const expected = nonWinner(winnerId);
				const ok =
					order.length === expected.length &&
					new Set(order).size === order.length &&
					order.every((u) => partIds.has(u) && u !== winnerId);
				if (!ok) throw new LedgerError('Rank every loser exactly once');
				deltas = tieredDeltas(pool, winnerId, order);
				order.forEach((u, i) => lossRankByUser.set(u, i + 1));
			}
		}

		const walletByUser = new Map<string, string>();
		for (const p of parts) {
			walletByUser.set(p.userId, await getOrCreateUserWallet(p.userId, tx));
		}

		const plan = planSettlement(
			deltas.filter((d) => d.delta > 0).map((d) => ({ userId: d.userId, amount: d.delta })),
			deltas.filter((d) => d.delta < 0).map((d) => ({ userId: d.userId, amount: -d.delta }))
		);

		const transferIds: string[] = [];
		for (const t of plan) {
			const transferId = await transferInTx(tx, {
				fromWalletId: walletByUser.get(t.fromUserId)!,
				toWalletId: walletByUser.get(t.toUserId)!,
				amount: t.amount,
				memo: `Bet: ${bet.title}`,
				createdBy: resolvedBy,
				betId: bet.id
			});
			transferIds.push(transferId);
		}

		for (const d of deltas) {
			const outcome = d.delta > 0 ? 'won' : d.delta < 0 ? 'lost' : 'none';
			await tx
				.update(betParticipants)
				.set({ outcome, settledDelta: d.delta, lossRank: lossRankByUser.get(d.userId) ?? null })
				.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, d.userId)));
		}

		await tx
			.update(bets)
			.set({ status: 'resolved', resolvedAt: new Date(), resolvedBy, resolutionNote: note })
			.where(eq(bets.id, betId));

		// Stats: this bet leaves the open pool and joins the resolved count; the
		// CB moved by the settlement adds to the lifetime wagered total.
		const totalMoved = plan.reduce((sum, t) => sum + t.amount, 0);
		await bumpStats(tx, { betsOpen: -1, betsResolved: 1, bucksWagered: totalMoved });

		return { transferIds, title: bet.title, participantIds: deltas.map((d) => d.userId) };
	});

	// Tell the other participants the bet settled (the resolver just did it).
	const [resolver] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, resolvedBy))
		.limit(1);
	const who = resolver?.displayName ?? 'Someone';
	for (const uid of result.participantIds) {
		if (uid === resolvedBy) continue;
		await createNotification({
			userId: uid,
			level: 'info',
			title: `${who} settled a bet`,
			body: `"${result.title}" was resolved — see how you did.`,
			link: `/app/bet/${betId}`
		}).catch(() => {});
	}

	// Award badges to every participant (Running with the Pack / Winner / All
	// Bones In all derive from resolved-bet history) plus the resolver, who may
	// not be a participant but earns The Dog House for settling. Best-effort — a
	// badge failure must not undo the settlement.
	for (const uid of new Set([...result.participantIds, resolvedBy])) {
		await evaluateBadges(uid).catch((err) => console.warn('[badges] eval failed:', err));
	}

	return { transferIds: result.transferIds };
}

export async function cancelBet(opts: { betId: string; cancelledBy: string }): Promise<void> {
	const { betId, cancelledBy } = opts;
	await db.transaction(async (tx) => {
		const [bet] = await tx
			.select({ status: bets.status })
			.from(bets)
			.where(eq(bets.id, betId))
			.limit(1);
		if (!bet) throw new LedgerError('Bet not found');
		// A pending (not-yet-live) bet can also be called off by a participant.
		if (bet.status !== 'open' && bet.status !== 'pending') {
			throw new LedgerError(`Bet is already ${bet.status}`);
		}
		await tx
			.update(bets)
			.set({ status: 'cancelled', cancelledAt: new Date(), cancelledBy })
			.where(eq(bets.id, betId));
		// Only live bets are counted in betsOpen; pending ones aren't.
		if (bet.status === 'open') await bumpStats(tx, { betsOpen: -1 });
	});
}

/** Is the user a participant in this bet? (Route guard for bet detail/resolve.) */
export async function isBetParticipant(betId: string, userId: string): Promise<boolean> {
	const [row] = await db
		.select({ userId: betParticipants.userId })
		.from(betParticipants)
		.where(and(eq(betParticipants.betId, betId), eq(betParticipants.userId, userId)))
		.limit(1);
	return !!row;
}
