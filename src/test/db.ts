import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { hashPassword } from '$lib/server/auth/password';

/**
 * The database name the app is currently configured to use (from DATABASE_URL).
 * DB-backed suites ONLY run against a database whose name ends in `_test`, so
 * they can never touch a dev/prod database even if misconfigured.
 *
 * To run them: create a `*_test` database, migrate it, and point DATABASE_URL
 * at it for the test run — easiest via a gitignored `.env.test`:
 *   DATABASE_URL="postgres://crub:crub@localhost:5432/crubbucks_test"
 */
function currentDbName(): string {
	const url = env.DATABASE_URL;
	if (!url) return '';
	try {
		return new URL(url).pathname.replace(/^\//, '');
	} catch {
		return '';
	}
}

export const hasTestDb = currentDbName().endsWith('_test');

const ALL_TABLES = [
	'users',
	'friendships',
	'friend_invites',
	'wallets',
	'ledger_entries',
	'bets',
	'bet_participants',
	'auth_tokens',
	'security_events',
	'sessions',
	'system_config'
].join(', ');

/** Wipe every table between tests — with a hard guard against non-test DBs. */
export async function resetDb(): Promise<void> {
	const rows = (await db.execute(
		sql`select current_database() as name`
	)) as unknown as Array<{ name: string }>;
	const name = rows[0]?.name ?? '';
	if (!String(name).endsWith('_test')) {
		throw new Error(
			`Refusing to TRUNCATE non-test database "${name}". Point DATABASE_URL at a *_test database.`
		);
	}
	await db.execute(sql.raw(`TRUNCATE ${ALL_TABLES} RESTART IDENTITY CASCADE`));
}

let counter = 0;

export interface TestUser {
	id: string;
	email: string;
	displayName: string;
}

/** Insert a verified user (override with verified:false for unverified). */
export async function createUser(opts?: {
	email?: string;
	displayName?: string;
	verified?: boolean;
}): Promise<TestUser> {
	counter++;
	const email = (opts?.email ?? `user${counter}@test.local`).toLowerCase();
	const displayName = opts?.displayName ?? `User${counter}`;
	const [u] = await db
		.insert(users)
		.values({
			email,
			displayName,
			passwordHash: hashPassword('password1234!'),
			emailVerifiedAt: opts?.verified === false ? null : new Date()
		})
		.returning({ id: users.id, email: users.email, displayName: users.displayName });
	return u;
}
