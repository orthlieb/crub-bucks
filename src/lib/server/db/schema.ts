import {
	pgTable,
	text,
	timestamp,
	integer,
	bigint,
	boolean,
	uuid,
	jsonb,
	uniqueIndex,
	index,
	primaryKey,
	pgEnum,
	customType
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// Raw binary column (Postgres bytea). Holds stored avatar image bytes.
const bytea = customType<{ data: Buffer; default: false }>({
	dataType() {
		return 'bytea';
	}
});

// ---------------------------------------------------------------------------
// Crub Bucks data model — v3 (friends + standalone bets)
//
// Core invariant: across the entire system, the sum of all wallet balances is
// always exactly zero. Every economic event is a transfer that writes two
// ledger rows with equal-and-opposite deltas in one transaction. Balances are
// derived (never stored), so they can't drift.
//
// Social model: there are no named groups. Users add each other as FRIENDS
// (mutual, instant — two directed rows per friendship). A bet is the only
// "grouping" that exists: you create a bet, add some friends (you're always a
// participant), and resolve it later. Each participant declares a payout (if
// they win) and a loss (if they lose); at resolution the ledger moves CB from
// losers to winners and enforces sum(payouts) == sum(losses).
//
// Wallets are global: one per user, plus a single system-wide Bank. New users
// receive a 100 CB welcome grant from the Bank on first login (Bank goes -100;
// see users.welcomeGrantedAt).
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum('user_role', ['user', 'admin']);
export const walletKindEnum = pgEnum('wallet_kind', ['user', 'bank']);
export const authTokenPurposeEnum = pgEnum('auth_token_purpose', [
	'verify_email',
	'reset_password'
]);
export const betStatusEnum = pgEnum('bet_status', ['pending', 'open', 'resolved', 'cancelled']);
// 'none' = participant was in the bet but settled to zero (e.g. winner_loser extras)
export const betOutcomeEnum = pgEnum('bet_outcome', ['pending', 'won', 'lost', 'none']);
export const betModeEnum = pgEnum('bet_mode', [
	'even_split',
	'winner_loser',
	'tiered',
	'pot',
	'custom',
	'odds'
]);
export const friendshipStatusEnum = pgEnum('friendship_status', ['pending', 'accepted']);
export const notificationLevelEnum = pgEnum('notification_level', ['info', 'success', 'warning']);
export const badgeTierEnum = pgEnum('badge_tier', ['bronze', 'silver', 'gold']);

// ---------------------------------------------------------------------------
// Users + sessions
// ---------------------------------------------------------------------------

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull(),
		// scrypt hash today; planned to migrate to argon2id (see auth tasks)
		passwordHash: text('password_hash').notNull(),
		displayName: text('display_name').notNull(),
		role: userRoleEnum('role').notNull().default('user'),
		// false = suspended / locked out. login is refused.
		isActive: boolean('is_active').notNull().default(true),
		// null until the user clicks the verification email link
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
		lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
		// stamped the first time the 100 CB welcome grant is issued (idempotency)
		welcomeGrantedAt: timestamp('welcome_granted_at', { withTimezone: true }),
		// rolling counter; reset on successful login. when it crosses the
		// threshold the login flow flips isActive=false (lockout).
		failedLoginCount: integer('failed_login_count').notNull().default(0),
		// null = no uploaded photo (render a generated initials avatar). When set,
		// the user has a row in user_avatars; the timestamp also cache-busts the
		// served image URL.
		avatarUpdatedAt: timestamp('avatar_updated_at', { withTimezone: true }),
		// A single emoji chosen as the profile picture instead of a photo. Mutually
		// exclusive with a photo: setting one clears the other. null = no icon.
		// Render precedence is photo → icon → generated initials.
		avatarIcon: text('avatar_icon'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		emailIdx: uniqueIndex('users_email_idx').on(t.email)
	})
);

// Uploaded avatar bytes, one row per user. Kept out of the users table so the
// large binary blob never rides along on ordinary user/balance queries. Images
// are downsampled to 512×512 before storage.
export const userAvatars = pgTable('user_avatars', {
	userId: uuid('user_id')
		.primaryKey()
		.references(() => users.id, { onDelete: 'cascade' }),
	data: bytea('data').notNull(),
	contentType: text('content_type').notNull(),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const sessions = pgTable('sessions', {
	// session id stored as a SHA-256 hash of the token the client holds
	id: text('id').primaryKey(),
	userId: uuid('user_id')
		.notNull()
		.references(() => users.id, { onDelete: 'cascade' }),
	expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
	// Whether the user ticked "remember me" on login. Drives cookie
	// persistence: true → cookie has an expires (survives browser restart);
	// false → no expires (session cookie, dies when browser closes). The DB
	// expiresAt is the same in either case; this only affects the cookie.
	remember: boolean('remember').notNull().default(false),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	userAgent: text('user_agent'),
	ipAddress: text('ip_address')
});

// ---------------------------------------------------------------------------
// Friendships (request → accept handshake)
// One canonical row per relationship: the requester sends, the addressee
// accepts or denies (deny = row deleted). status='accepted' means mutual
// friends. "Are A and B friends" checks an accepted row in EITHER direction;
// the unique (requester, addressee) index plus app-level checks prevent
// duplicate pending pairs.
// ---------------------------------------------------------------------------

export const friendships = pgTable(
	'friendships',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		requesterId: uuid('requester_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		addresseeId: uuid('addressee_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		status: friendshipStatusEnum('status').notNull().default('pending'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		respondedAt: timestamp('responded_at', { withTimezone: true })
	},
	(t) => ({
		pairIdx: uniqueIndex('friendships_pair_idx').on(t.requesterId, t.addresseeId),
		addresseeIdx: index('friendships_addressee_idx').on(t.addresseeId),
		requesterIdx: index('friendships_requester_idx').on(t.requesterId)
	})
);

// Per-side favorites. (userId, friendId) — Alice marking Bob does NOT mark
// Bob's view of Alice. App layer enforces that friendId is actually a friend
// before insert; the row is harmless if the friendship is later dropped, but
// it's removed via FK ON DELETE CASCADE when either user is deleted.
export const friendFavorites = pgTable(
	'friend_favorites',
	{
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		friendId: uuid('friend_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		pk: primaryKey({ columns: [t.userId, t.friendId] }),
		userIdx: index('friend_favorites_user_idx').on(t.userId)
	})
);

// ---------------------------------------------------------------------------
// Friend invites (to email addresses that aren't users yet)
// When you "friend" an email with no account, we record an invite and email
// them to join. On registration with that email, each unclaimed invite is
// materialized into a pending friend request (claimedAt/claimedUserId stamped).
// ---------------------------------------------------------------------------

export const friendInvites = pgTable(
	'friend_invites',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		inviterId: uuid('inviter_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// lowercased invited email
		email: text('email').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		claimedAt: timestamp('claimed_at', { withTimezone: true }),
		claimedUserId: uuid('claimed_user_id').references(() => users.id, { onDelete: 'set null' })
	},
	(t) => ({
		inviterEmailIdx: uniqueIndex('friend_invites_inviter_email_idx').on(t.inviterId, t.email),
		emailIdx: index('friend_invites_email_idx').on(t.email)
	})
);

// ---------------------------------------------------------------------------
// Wallets (global) — one per user, plus a single system-wide Bank
// ---------------------------------------------------------------------------

export const wallets = pgTable(
	'wallets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// null for the bank wallet; otherwise the owning user (unique).
		userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
		kind: walletKindEnum('kind').notNull().default('user'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		// partial unique index: at most one wallet per user (excludes bank rows)
		oneWalletPerUser: uniqueIndex('wallets_user_idx')
			.on(t.userId)
			.where(sql`${t.userId} IS NOT NULL`),
		// partial unique index: exactly-one bank wallet system-wide
		oneBankWallet: uniqueIndex('wallets_one_bank_idx')
			.on(t.kind)
			.where(sql`${t.kind} = 'bank'`)
	})
);

// ---------------------------------------------------------------------------
// Immutable double-entry ledger
// Two rows share a transfer_id and their deltas sum to zero. Amounts are
// whole Crub Bucks (signed bigint). Never UPDATE or DELETE — corrections are
// new, reversing transfers. bet_id is optional context (set for transfers
// produced by bet resolution); it does not affect the zero-sum invariant.
// ---------------------------------------------------------------------------

export const ledgerEntries = pgTable(
	'ledger_entries',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		transferId: uuid('transfer_id').notNull(),
		walletId: uuid('wallet_id')
			.notNull()
			.references(() => wallets.id, { onDelete: 'cascade' }),
		// signed: negative debits the wallet, positive credits it
		delta: bigint('delta', { mode: 'number' }).notNull(),
		memo: text('memo'),
		// Single-grapheme emoji chosen by the payer ("🍕", "🎁", "💸"). Both
		// legs of a transfer carry the same icon, just like memo. Nullable for
		// system-issued transfers (welcome grant, bet settlements) and rows
		// that pre-date the picker; the display falls back to a default.
		icon: text('icon'),
		// optional context — which bet resolution produced this entry (if any)
		betId: uuid('bet_id').references(() => bets.id, { onDelete: 'set null' }),
		// the user who initiated the transfer; null for system seeds / grants
		createdBy: uuid('created_by').references(() => users.id),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		walletIdx: index('ledger_wallet_idx').on(t.walletId),
		transferIdx: index('ledger_transfer_idx').on(t.transferId),
		betIdx: index('ledger_bet_idx').on(t.betId)
	})
);

// ---------------------------------------------------------------------------
// Bets (standalone — no group)
// ---------------------------------------------------------------------------

export const bets = pgTable(
	'bets',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		title: text('title').notNull(),
		// emoji chosen by the creator — single grapheme like "🎲". Nullable for
		// rows that pre-date the picker; the display side falls back to a default.
		icon: text('icon'),
		status: betStatusEnum('status').notNull().default('open'),
		// how the pot is split at resolution
		mode: betModeEnum('mode').notNull().default('custom'),
		// the pot the winner takes (= sum of losses); null for custom mode.
		// For 'pot' mode this grows as participants re-buy.
		pool: bigint('pool', { mode: 'number' }),
		// 'pot' mode only: the initial per-player buy-in. Re-buys grow each
		// participant's bought_in (and the pool) but leave stake unchanged.
		stake: bigint('stake', { mode: 'number' }),
		createdBy: uuid('created_by')
			.notNull()
			.references(() => users.id),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		// when the bet flipped from 'pending' to 'open' (everyone accepted).
		// null for bets created before acceptance existed or still pending.
		wentLiveAt: timestamp('went_live_at', { withTimezone: true }),
		resolvedAt: timestamp('resolved_at', { withTimezone: true }),
		resolvedBy: uuid('resolved_by').references(() => users.id),
		// optional note the resolver leaves when settling the bet
		resolutionNote: text('resolution_note'),
		cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
		cancelledBy: uuid('cancelled_by').references(() => users.id)
	},
	(t) => ({
		createdByIdx: index('bets_created_by_idx').on(t.createdBy),
		statusIdx: index('bets_status_idx').on(t.status)
	})
);

// Participants. For CUSTOM bets, payoutIfWin / lossIfLose are set at creation
// (positive magnitudes). For the pooled modes (even_split / winner_loser /
// tiered) they're null at creation — the per-person amounts are computed from
// the pool + mode at resolution. After resolution, settledDelta holds each
// participant's signed net (+ won / − lost / 0), and lossRank holds their
// loser rank for tiered bets.
export const betParticipants = pgTable(
	'bet_participants',
	{
		betId: uuid('bet_id')
			.notNull()
			.references(() => bets.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		payoutIfWin: bigint('payout_if_win', { mode: 'number' }),
		lossIfLose: bigint('loss_if_lose', { mode: 'number' }),
		outcome: betOutcomeEnum('outcome').notNull().default('pending'),
		settledDelta: bigint('settled_delta', { mode: 'number' }),
		lossRank: integer('loss_rank'),
		// When this participant accepted the bet invitation. Null = invited but
		// not yet accepted. A bet goes live (status 'open') once every
		// participant has a non-null accepted_at. The creator is auto-accepted.
		acceptedAt: timestamp('accepted_at', { withTimezone: true }),
		// 'pot' mode only: this participant's total contribution to the pot
		// (initial stake + any re-buys they've added while the bet is open).
		boughtIn: bigint('bought_in', { mode: 'number' })
	},
	(t) => ({
		pk: primaryKey({ columns: [t.betId, t.userId] }),
		userIdx: index('bet_participants_user_idx').on(t.userId)
	})
);

// ---------------------------------------------------------------------------
// Auth tokens (email verification + password reset)
// ---------------------------------------------------------------------------

export const authTokens = pgTable(
	'auth_tokens',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// SHA-256 of the raw token mailed to the user. The raw token never
		// touches the database.
		tokenHash: text('token_hash').notNull(),
		purpose: authTokenPurposeEnum('purpose').notNull(),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		// non-null once redeemed. one-time use.
		usedAt: timestamp('used_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		tokenHashIdx: uniqueIndex('auth_tokens_hash_idx').on(t.tokenHash),
		userPurposeIdx: index('auth_tokens_user_purpose_idx').on(t.userId, t.purpose)
	})
);

// ---------------------------------------------------------------------------
// Security events (immutable audit log)
// userId is nullable so the audit trail survives user deletion.
// ---------------------------------------------------------------------------

export const securityEvents = pgTable(
	'security_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
		eventType: text('event_type').notNull(),
		ipAddress: text('ip_address'),
		userAgent: text('user_agent'),
		metadata: jsonb('metadata'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		userCreatedIdx: index('security_events_user_created_idx').on(t.userId, t.createdAt),
		typeCreatedIdx: index('security_events_type_created_idx').on(t.eventType, t.createdAt)
	})
);

// ---------------------------------------------------------------------------
// System config (singleton)
// ---------------------------------------------------------------------------

export const systemConfig = pgTable('system_config', {
	id: text('id').primaryKey(), // always 'system'
	maintenanceMode: boolean('maintenance_mode').notNull().default(false),
	maintenanceMessage: text('maintenance_message'),
	registrationLock: boolean('registration_lock').notNull().default(false),
	registrationLockMessage: text('registration_lock_message'),
	// Soft cap on signups per calendar day (server local TZ). null = no cap.
	// Used for "easing in" launches — once today's successful registrations
	// reach this number, further attempts are rejected with the message
	// below (or a default) until tomorrow.
	registrationDailyLimit: integer('registration_daily_limit'),
	registrationDailyLimitMessage: text('registration_daily_limit_message'),
	updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' })
});

// ---------------------------------------------------------------------------
// Notifications
//
// Two kinds of message in one table:
//   - userId NULL → broadcast (shown to everyone, dismissible per user)
//   - userId set  → targeted at one user (admin DM or system-generated, e.g.
//                   the welcome grant message issued on first login)
//
// Dismissals live in their own table so a broadcast can be dismissed by one
// user without hiding it for the rest. Admin deleting a notification cascades
// dismissals away with it.
// ---------------------------------------------------------------------------

export const notifications = pgTable(
	'notifications',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		// null = broadcast (every user sees it). Cascading on user delete just
		// cleans up targeted notifications for departed users.
		userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
		level: notificationLevelEnum('level').notNull().default('info'),
		title: text('title').notNull(),
		body: text('body'),
		// optional in-app path the notification links to (e.g. /app/bet/<id>).
		link: text('link'),
		// optional image shown beside the notification (e.g. a badge "bug"
		// medallion at /bug-<tier>.png). Falls back to text/emoji when null.
		icon: text('icon'),
		// the admin who sent it; null for system-generated rows like welcome
		createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		userCreatedIdx: index('notifications_user_created_idx').on(t.userId, t.createdAt),
		createdIdx: index('notifications_created_idx').on(t.createdAt)
	})
);

export const notificationDismissals = pgTable(
	'notification_dismissals',
	{
		notificationId: uuid('notification_id')
			.notNull()
			.references(() => notifications.id, { onDelete: 'cascade' }),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		pk: primaryKey({ columns: [t.notificationId, t.userId] })
	})
);

// ---------------------------------------------------------------------------
// Relations (for drizzle's query API)
// ---------------------------------------------------------------------------

export const usersRelations = relations(users, ({ many, one }) => ({
	wallet: one(wallets, { fields: [users.id], references: [wallets.userId] }),
	createdBets: many(bets, { relationName: 'bet_creator' }),
	betParticipations: many(betParticipants),
	sentRequests: many(friendships, { relationName: 'friendship_requester' }),
	receivedRequests: many(friendships, { relationName: 'friendship_addressee' })
}));

export const friendshipsRelations = relations(friendships, ({ one }) => ({
	requester: one(users, {
		fields: [friendships.requesterId],
		references: [users.id],
		relationName: 'friendship_requester'
	}),
	addressee: one(users, {
		fields: [friendships.addresseeId],
		references: [users.id],
		relationName: 'friendship_addressee'
	})
}));

export const friendInvitesRelations = relations(friendInvites, ({ one }) => ({
	inviter: one(users, { fields: [friendInvites.inviterId], references: [users.id] }),
	claimedUser: one(users, { fields: [friendInvites.claimedUserId], references: [users.id] })
}));

export const walletsRelations = relations(wallets, ({ one, many }) => ({
	owner: one(users, { fields: [wallets.userId], references: [users.id] }),
	entries: many(ledgerEntries)
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
	wallet: one(wallets, { fields: [ledgerEntries.walletId], references: [wallets.id] }),
	bet: one(bets, { fields: [ledgerEntries.betId], references: [bets.id] }),
	creator: one(users, { fields: [ledgerEntries.createdBy], references: [users.id] })
}));

export const betsRelations = relations(bets, ({ one, many }) => ({
	creator: one(users, {
		fields: [bets.createdBy],
		references: [users.id],
		relationName: 'bet_creator'
	}),
	resolver: one(users, { fields: [bets.resolvedBy], references: [users.id] }),
	canceller: one(users, { fields: [bets.cancelledBy], references: [users.id] }),
	participants: many(betParticipants),
	ledgerEntries: many(ledgerEntries)
}));

export const betParticipantsRelations = relations(betParticipants, ({ one }) => ({
	bet: one(bets, { fields: [betParticipants.betId], references: [bets.id] }),
	user: one(users, { fields: [betParticipants.userId], references: [users.id] })
}));

export const authTokensRelations = relations(authTokens, ({ one }) => ({
	user: one(users, { fields: [authTokens.userId], references: [users.id] })
}));

export const securityEventsRelations = relations(securityEvents, ({ one }) => ({
	user: one(users, { fields: [securityEvents.userId], references: [users.id] })
}));

// ---------------------------------------------------------------------------
// Global stats (denormalised counters)
// A single row (id = 1) maintained incrementally inside the same transaction
// as the mutations that change it (see $lib/server/stats). recomputeStats()
// can rebuild it from source data if it ever drifts.
// ---------------------------------------------------------------------------
export const appStats = pgTable('app_stats', {
	id: integer('id').primaryKey(),
	betsOpen: bigint('bets_open', { mode: 'number' }).notNull().default(0),
	betsResolved: bigint('bets_resolved', { mode: 'number' }).notNull().default(0),
	bucksWagered: bigint('bucks_wagered', { mode: 'number' }).notNull().default(0),
	bankTotal: bigint('bank_total', { mode: 'number' }).notNull().default(0)
});

// ---------------------------------------------------------------------------
// Badges / awards. One row per (user, badge); the tier is upgraded in place as
// the user climbs (forward-only — bronze → silver → gold, never backwards).
// Badge *definitions* live in code ($lib/server/badges/catalog); only the
// earned awards persist here, so the set is recomputable from bet history.
// ---------------------------------------------------------------------------
export const userBadges = pgTable(
	'user_badges',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// matches a key in the code-side badge registry
		badgeKey: text('badge_key').notNull(),
		// current highest tier reached
		tier: badgeTierEnum('tier').notNull(),
		// when the current tier was reached
		earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
		// snapshot of the metric value at the current tier (display/debug)
		metricValue: bigint('metric_value', { mode: 'number' })
	},
	(t) => ({
		// one badge per user; the forward-only upsert targets this constraint
		userBadgeIdx: uniqueIndex('user_badges_user_badge_idx').on(t.userId, t.badgeKey),
		userIdx: index('user_badges_user_idx').on(t.userId)
	})
);

export const userBadgesRelations = relations(userBadges, ({ one }) => ({
	user: one(users, { fields: [userBadges.userId], references: [users.id] })
}));

// ---------------------------------------------------------------------------
// Web Push subscriptions — one row per device/browser a user has opted in on.
// Populated by the client's pushManager.subscribe(); the server sends VAPID-
// signed pushes to these endpoints. Dead endpoints (404/410) are pruned on send.
// ---------------------------------------------------------------------------
export const pushSubscriptions = pgTable(
	'push_subscriptions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		userId: uuid('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		// the browser push service endpoint (unique per device subscription)
		endpoint: text('endpoint').notNull().unique(),
		// client public key + auth secret from the PushSubscription
		p256dh: text('p256dh').notNull(),
		auth: text('auth').notNull(),
		// best-effort device label for "manage your devices" UX later
		userAgent: text('user_agent'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => ({
		userIdx: index('push_subscriptions_user_idx').on(t.userId)
	})
);
