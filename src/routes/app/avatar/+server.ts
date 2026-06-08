import { error, json } from '@sveltejs/kit';
import {
	clearAvatar,
	MAX_AVATAR_BYTES,
	setAvatar,
	setAvatarIcon,
	sniffImageType
} from '$lib/server/avatar';
import { sanitizeAvatarIcon } from '$lib/avatar-icon';
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

/**
 * Set the current user's avatar to an emoji icon (instead of a photo). Body is
 * JSON `{ icon: string }`; the emoji must be a single grapheme. Setting an icon
 * clears any uploaded photo.
 */
export const PUT: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');

	const body = await request.json().catch(() => null);
	const icon = sanitizeAvatarIcon((body as { icon?: unknown } | null)?.icon);
	if (!icon) throw error(400, 'Please choose a single emoji.');

	await setAvatarIcon(locals.user.id, icon);
	return json({ ok: true, icon });
};

/** Remove the current user's avatar, reverting to the generated initials. */
export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'Unauthorized');
	await clearAvatar(locals.user.id);
	return json({ ok: true });
};
