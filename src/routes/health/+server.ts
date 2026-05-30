import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import type { RequestHandler } from './$types';

/**
 * Liveness/health probe for the deploy script and any uptime monitor.
 *
 *   GET /health
 *
 * Returns 200 with { ok: true } when the Node process is up AND the DB
 * connection succeeds. 503 if the DB ping fails — that means Postgres
 * isn't reachable (managed DB outage, expired creds, network glitch),
 * so deploy should be considered failed.
 *
 * No auth and no logging — this endpoint gets hit on a schedule.
 */
export const GET: RequestHandler = async () => {
	try {
		await db.execute(sql`select 1`);
		return json({ ok: true });
	} catch (err) {
		console.error('[health] db ping failed', err);
		return json({ ok: false, error: 'database unreachable' }, { status: 503 });
	}
};
