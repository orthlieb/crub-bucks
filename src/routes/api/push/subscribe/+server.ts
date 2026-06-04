import { json, error } from '@sveltejs/kit';
import { savePushSubscription, isValidSubscription } from '$lib/server/push';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const sub = await request.json().catch(() => null);
	if (!isValidSubscription(sub)) throw error(400, 'Invalid push subscription');
	await savePushSubscription(locals.user.id, sub, request.headers.get('user-agent'));
	return json({ ok: true });
};
