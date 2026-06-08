import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import argon2 from 'argon2';
import * as schema from './schema';
import { users, friendships, wallets, bets, betParticipants, ledgerEntries } from './schema';

/**
 * Standalone seed for local dev. Builds a friends + bets scenario:
 *   - 4 verified users (Carl, Dana, Theo, Mira), password "password123"
 *   - everyone is mutual friends with everyone (a small clique)
 *   - each user has the 100 CB welcome grant applied (bank ends at -400)
 *   - 1 resolved bet (Carl & Dana beat Theo & Mira)
 *   - 1 open bet awaiting resolution
 *
 * Talks directly to drizzle so it doesn't need SvelteKit's $env aliases.
 */

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set');
const sql = postgres(url, { max: 1 });
const db = drizzle(sql, { schema });

function hashPassword(pw: string): Promise<string> {
	// Mirrors $lib/server/auth/password.hashPassword, reimplemented here so the
	// seed script doesn't need SvelteKit's $lib/$env aliases.
	return argon2.hash(pw.normalize('NFKC'), { type: argon2.argon2id });
}

async function transfer(opts: {
	fromWalletId: string;
	toWalletId: string;
	amount: number;
	memo: string;
	betId?: string | null;
	createdBy?: string | null;
}) {
	const transferId = crypto.randomUUID();
	await db.insert(ledgerEntries).values([
		{
			transferId,
			walletId: opts.fromWalletId,
			delta: -opts.amount,
			memo: opts.memo,
			betId: opts.betId ?? null,
			createdBy: opts.createdBy ?? null
		},
		{
			transferId,
			walletId: opts.toWalletId,
			delta: opts.amount,
			memo: opts.memo,
			betId: opts.betId ?? null,
			createdBy: opts.createdBy ?? null
		}
	]);
}

console.log('Seeding demo data…');

const hash = await hashPassword('password123');
const now = new Date();

const [carl, dana, theo, mira, nina] = await db
	.insert(users)
	.values(
		['Carl', 'Dana', 'Theo', 'Mira', 'Nina'].map((name) => ({
			email: `${name.toLowerCase()}@example.com`,
			displayName: name,
			passwordHash: hash,
			emailVerifiedAt: now,
			// Nina is a brand-new user who hasn't logged in yet — no welcome
			// grant until her first login. The clique have already received theirs.
			welcomeGrantedAt: name === 'Nina' ? null : now,
			role: 'user' as const
		}))
	)
	.returning();

// Carl, Dana, Theo, Mira are the active clique. Nina is a newcomer who has
// sent Carl a friend request (still pending) — to demo the handshake UI.
const userList = [carl, dana, theo, mira];

// Single global bank wallet + one wallet per user (incl. Nina).
const [bank] = await db.insert(wallets).values({ kind: 'bank', userId: null }).returning();
const userWallets: Record<string, string> = {};
for (const u of [...userList, nina]) {
	const [w] = await db.insert(wallets).values({ kind: 'user', userId: u.id }).returning();
	userWallets[u.id] = w.id;
}

// Accepted friendships: every pair among the clique (one canonical row each).
const acceptedRows: {
	requesterId: string;
	addresseeId: string;
	status: 'accepted';
	respondedAt: Date;
}[] = [];
for (let i = 0; i < userList.length; i++) {
	for (let j = i + 1; j < userList.length; j++) {
		acceptedRows.push({
			requesterId: userList[i].id,
			addresseeId: userList[j].id,
			status: 'accepted',
			respondedAt: now
		});
	}
}
await db.insert(friendships).values(acceptedRows);

// Pending: Nina → Carl (incoming request shows up when you log in as Carl).
await db
	.insert(friendships)
	.values({ requesterId: nina.id, addresseeId: carl.id, status: 'pending' });

// Welcome grants: 100 CB each from the bank (bank ends at -400).
for (const u of userList) {
	await transfer({
		fromWalletId: bank.id,
		toWalletId: userWallets[u.id],
		amount: 100,
		memo: 'Welcome grant',
		createdBy: null
	});
}

// --- Resolved bet: Carl & Dana beat Theo & Mira ------------------------
const [resolvedBet] = await db
	.insert(bets)
	.values({
		title: 'Cornhole — Carl & Dana vs Theo & Mira',
		icon: '🌽',
		status: 'resolved',
		mode: 'custom',
		createdBy: carl.id,
		resolvedAt: now,
		resolvedBy: carl.id
	})
	.returning();

await db.insert(betParticipants).values([
	{
		betId: resolvedBet.id,
		userId: carl.id,
		payoutIfWin: 15,
		lossIfLose: 15,
		outcome: 'won',
		settledDelta: 15
	},
	{
		betId: resolvedBet.id,
		userId: dana.id,
		payoutIfWin: 15,
		lossIfLose: 15,
		outcome: 'won',
		settledDelta: 15
	},
	{
		betId: resolvedBet.id,
		userId: theo.id,
		payoutIfWin: 15,
		lossIfLose: 15,
		outcome: 'lost',
		settledDelta: -15
	},
	{
		betId: resolvedBet.id,
		userId: mira.id,
		payoutIfWin: 15,
		lossIfLose: 15,
		outcome: 'lost',
		settledDelta: -15
	}
]);

// Settle: Theo -> Carl 15, Mira -> Dana 15.
await transfer({
	fromWalletId: userWallets[theo.id],
	toWalletId: userWallets[carl.id],
	amount: 15,
	memo: `Bet: ${resolvedBet.title}`,
	betId: resolvedBet.id,
	createdBy: carl.id
});
await transfer({
	fromWalletId: userWallets[mira.id],
	toWalletId: userWallets[dana.id],
	amount: 15,
	memo: `Bet: ${resolvedBet.title}`,
	betId: resolvedBet.id,
	createdBy: carl.id
});

// --- Open bet: tiered pool, awaiting resolution ------------------------
const [openBet] = await db
	.insert(bets)
	.values({
		title: 'Poker night — winner takes 30',
		icon: '🃏',
		status: 'open',
		mode: 'tiered',
		pool: 30,
		createdBy: dana.id
	})
	.returning();

await db.insert(betParticipants).values([
	{ betId: openBet.id, userId: dana.id, outcome: 'pending' },
	{ betId: openBet.id, userId: carl.id, outcome: 'pending' },
	{ betId: openBet.id, userId: theo.id, outcome: 'pending' }
]);

// --- Cancelled bet (shows up in the feed as called off) ----------------
const [cancelledBet] = await db
	.insert(bets)
	.values({
		title: 'Rain check on mini-golf',
		icon: '⛳',
		status: 'cancelled',
		createdBy: carl.id,
		cancelledAt: now,
		cancelledBy: carl.id
	})
	.returning();

await db.insert(betParticipants).values([
	{ betId: cancelledBet.id, userId: carl.id, payoutIfWin: 10, lossIfLose: 10 },
	{ betId: cancelledBet.id, userId: mira.id, payoutIfWin: 10, lossIfLose: 10 }
]);

// --- A direct payment (shows up in the public feed) --------------------
await transfer({
	fromWalletId: userWallets[dana.id],
	toWalletId: userWallets[theo.id],
	amount: 5,
	memo: 'pizza',
	createdBy: dana.id
});

// --- Zero-sum check ----------------------------------------------------
const rows = await db.select({ delta: ledgerEntries.delta }).from(ledgerEntries);
const total = rows.reduce((s, r) => s + Number(r.delta), 0);
console.log(`Global ledger total (should be 0): ${total}`);

console.log('');
console.log('Logins (all password "password123"):');
for (const u of [...userList, nina]) console.log(`  ${u.email}`);
console.log('');
console.log('Carl, Dana, Theo, Mira are all friends. Nina (new) has a pending');
console.log('friend request to Carl — log in as carl@example.com to see it.');
console.log('Seeded: 1 resolved bet, 1 open bet, 1 payment (Dana → Theo).');
console.log('');
console.log('To promote an admin:');
console.log(`  UPDATE users SET role='admin' WHERE email='carl@example.com';`);

await sql.end();
