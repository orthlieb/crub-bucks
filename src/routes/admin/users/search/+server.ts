import { json } from '@sveltejs/kit';
import { asc, ilike, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * Typeahead user search for admin UIs (notification targeting, etc).
 *
 * Admin-only — guarded by `/admin/+layout.server.ts` which 403s any
 * non-admin before this handler runs.
 *
 * Query params:
 *   q  — text to match against display name and email (case-insensitive
 *        substring). Returns [] if shorter than 2 chars.
 *
 * Returns up to 20 matches, name-first then email-first, ordered by
 * display name. Includes suspended (inactive) users so admins can DM
 * anyone they need to.
 */

const LIMIT = 20;
const MIN_QUERY_LEN = 2;

export const GET: RequestHandler = async ({ url }) => {
	const q = (url.searchParams.get('q') ?? '').trim();
	if (q.length < MIN_QUERY_LEN) return json([]);

	// Escape SQL LIKE wildcards so a literal '%' or '_' in the query doesn't
	// blow the search wide open.
	const escaped = q.replace(/[%_\\]/g, (m) => `\\${m}`);
	const needle = `%${escaped}%`;

	const rows = await db
		.select({
			id: users.id,
			displayName: users.displayName,
			email: users.email,
			isActive: users.isActive
		})
		.from(users)
		.where(or(ilike(users.displayName, needle), ilike(users.email, needle)))
		// Prefer matches whose display name leads with the query.
		.orderBy(
			sql`(${users.displayName} ILIKE ${escaped + '%'}) DESC`,
			asc(users.displayName)
		)
		.limit(LIMIT);

	return json(rows);
};
