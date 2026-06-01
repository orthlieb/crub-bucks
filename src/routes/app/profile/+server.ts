import { error, json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { validateDisplayName } from '$lib/server/display-name';
import type { RequestHandler } from './$types';

/** Update the current user's display name. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	let raw = '';
	try {
		const body = await request.json();
		raw = typeof body?.displayName === 'string' ? body.displayName : '';
	} catch {
		throw error(400, 'Invalid request');
	}

	const result = validateDisplayName(raw);
	if (!result.ok) throw error(422, result.message);

	await db.update(users).set({ displayName: result.value }).where(eq(users.id, locals.user.id));
	return json({ ok: true, displayName: result.value });
};
