import { error, json } from '@sveltejs/kit';
import { clearAvatar, MAX_AVATAR_BYTES, setAvatar, sniffImageType } from '$lib/server/avatar';
import type { RequestHandler } from './$types';

/**
 * Upload the current user's avatar. The body is the raw image bytes (the client
 * downsamples to 512×512 before sending). We sniff the real format from the
 * bytes and enforce a hard size cap rather than trusting the request headers.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const buf = Buffer.from(await request.arrayBuffer());
	if (buf.byteLength === 0) throw error(400, 'Empty upload');
	if (buf.byteLength > MAX_AVATAR_BYTES) throw error(413, 'Image too large');

	const type = sniffImageType(buf);
	if (!type) throw error(415, 'Unsupported image type');

	await setAvatar(locals.user.id, buf, type);
	return json({ ok: true, updatedAt: Date.now() });
};

/** Remove the current user's avatar, reverting to the generated initials. */
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	await clearAvatar(locals.user.id);
	return json({ ok: true });
};
