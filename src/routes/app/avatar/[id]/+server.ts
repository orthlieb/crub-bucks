import { error } from '@sveltejs/kit';
import { getAvatar } from '$lib/server/avatar';
import type { RequestHandler } from './$types';

/**
 * Serve a user's uploaded avatar bytes. Auth-gated to logged-in users (avatars
 * aren't secret, but there's no reason to expose them anonymously). The caller
 * appends ?v=<avatarUpdatedAt> so a changed photo busts any cache.
 */
export const GET: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const avatar = await getAvatar(params.id);
	if (!avatar) throw error(404, 'No avatar');

	const etag = `"${avatar.updatedAt.getTime()}"`;
	if (request.headers.get('if-none-match') === etag) {
		return new Response(null, { status: 304, headers: { etag } });
	}

	return new Response(new Uint8Array(avatar.data), {
		headers: {
			'content-type': avatar.contentType,
			etag,
			'cache-control': 'private, max-age=86400'
		}
	});
};
