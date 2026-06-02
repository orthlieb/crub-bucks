import { eq, sql } from 'drizzle-orm';
import { db } from './db';
import { appStats, bets, ledgerEntries, wallets } from './db/schema';

/**
 * Global stats counters, maintained incrementally inside the same transaction
 * as the mutations that change them. A single row (id = 1):
 *   - betsOpen     : current number of live (status 'open') bets   [gauge]
 *   - betsResolved : number of resolved bets                       [counter]
 *   - bucksWagered : total CB ever moved by bet resolutions        [counter]
 *   - bankTotal    : the Bank wallet balance (≤ 0)                 [gauge]
 *
 * Reading these is O(1) instead of scanning bets / the whole ledger.
 * recomputeStats() rebuilds the row from source data if it ever drifts.
 */

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const ID = 1;

export interface Stats {
	betsOpen: number;
	betsResolved: number;
	bucksWagered: number;
	bankTotal: number;
}

export type StatsDelta = Partial<Stats>;

/**
 * Apply signed deltas to the singleton stats row. Upserts, so the row is
 * created on first use (and after a test truncate) without a separate seed.
 * Call inside the same transaction as the mutation it reflects.
 */
export async function bumpStats(tx: DbOrTx, d: StatsDelta): Promise<void> {
	const betsOpen = d.betsOpen ?? 0;
	const betsResolved = d.betsResolved ?? 0;
	const bucksWagered = d.bucksWagered ?? 0;
	const bankTotal = d.bankTotal ?? 0;
	if (!betsOpen && !betsResolved && !bucksWagered && !bankTotal) return;

	await tx
		.insert(appStats)
		.values({ id: ID, betsOpen, betsResolved, bucksWagered, bankTotal })
		.onConflictDoUpdate({
			target: appStats.id,
			set: {
				betsOpen: sql`${appStats.betsOpen} + ${betsOpen}`,
				betsResolved: sql`${appStats.betsResolved} + ${betsResolved}`,
				bucksWagered: sql`${appStats.bucksWagered} + ${bucksWagered}`,
				bankTotal: sql`${appStats.bankTotal} + ${bankTotal}`
			}
		});
}

/** Read the current stats (zeros if the row doesn't exist yet). */
export async function getStats(): Promise<Stats> {
	const [row] = await db.select().from(appStats).where(eq(appStats.id, ID)).limit(1);
	return {
		betsOpen: Number(row?.betsOpen ?? 0),
		betsResolved: Number(row?.betsResolved ?? 0),
		bucksWagered: Number(row?.bucksWagered ?? 0),
		bankTotal: Number(row?.bankTotal ?? 0)
	};
}

/** Authoritative rebuild from source data (admin safety net / migration seed). */
export async function recomputeStats(tx: DbOrTx = db): Promise<Stats> {
	const [open] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(bets)
		.where(eq(bets.status, 'open'));
	const [resolved] = await tx
		.select({ n: sql<number>`count(*)::int` })
		.from(bets)
		.where(eq(bets.status, 'resolved'));
	const [wager] = await tx
		.select({ n: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries)
		.where(sql`${ledgerEntries.betId} is not null and ${ledgerEntries.delta} > 0`);
	const [bank] = await tx
		.select({ n: sql<number>`coalesce(sum(${ledgerEntries.delta}), 0)` })
		.from(ledgerEntries)
		.innerJoin(wallets, eq(wallets.id, ledgerEntries.walletId))
		.where(eq(wallets.kind, 'bank'));

	const next: Stats = {
		betsOpen: Number(open?.n ?? 0),
		betsResolved: Number(resolved?.n ?? 0),
		bucksWagered: Number(wager?.n ?? 0),
		bankTotal: Number(bank?.n ?? 0)
	};

	await tx
		.insert(appStats)
		.values({ id: ID, ...next })
		.onConflictDoUpdate({ target: appStats.id, set: next });
	return next;
}
