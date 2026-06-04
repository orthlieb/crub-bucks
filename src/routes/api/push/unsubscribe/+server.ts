import { json, error } from '@sveltejs/kit';
import { removePushSubscription } from '$lib/server/push';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const { endpoint } = (await request.json().catch(() => ({}))) as { endpoint?: string };
	if (endpoint) await removePushSubscription(locals.user.id, endpoint);
	return json({ ok: true });
};
