import { eq } from 'drizzle-orm';
import { db } from './db';
import { userAvatars, users } from './db/schema';

/**
 * Uploaded avatar storage. Images are downsampled to a 512×512 square on the
 * client before upload; the server only validates the type and a hard byte cap,
 * then stores the bytes in user_avatars and stamps users.avatar_updated_at
 * (which both flags "has a photo" and cache-busts the served URL).
 */

// Hard ceiling on stored bytes. A 512×512 WebP is comfortably under this; the
// cap is a safety net against a client bypassing the resize step.
export const MAX_AVATAR_BYTES = 512 * 1024; // 512 KB

export const ALLOWED_AVATAR_TYPES = ['image/webp', 'image/jpeg', 'image/png'] as const;
export type AvatarType = (typeof ALLOWED_AVATAR_TYPES)[number];

export function isAllowedAvatarType(t: string): t is AvatarType {
	return (ALLOWED_AVATAR_TYPES as readonly string[]).includes(t);
}

/**
 * Detect the real image type from magic bytes, so we store based on the actual
 * content rather than the client-supplied Content-Type. Returns null if the
 * bytes aren't one of the allowed image formats.
 */
export function sniffImageType(buf: Buffer): AvatarType | null {
	if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
		return 'image/png';
	}
	if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		buf.length >= 12 &&
		buf.toString('ascii', 0, 4) === 'RIFF' &&
		buf.toString('ascii', 8, 12) === 'WEBP'
	) {
		return 'image/webp';
	}
	return null;
}

export interface StoredAvatar {
	data: Buffer;
	contentType: string;
	updatedAt: Date;
}

/**
 * Upsert a user's avatar bytes and stamp users.avatar_updated_at. Clears any
 * emoji icon — a photo and an icon are mutually exclusive.
 */
export async function setAvatar(
	userId: string,
	data: Buffer,
	contentType: AvatarType
): Promise<void> {
	const now = new Date();
	await db.transaction(async (tx) => {
		await tx
			.insert(userAvatars)
			.values({ userId, data, contentType, updatedAt: now })
			.onConflictDoUpdate({
				target: userAvatars.userId,
				set: { data, contentType, updatedAt: now }
			});
		await tx
			.update(users)
			.set({ avatarUpdatedAt: now, avatarIcon: null })
			.where(eq(users.id, userId));
	});
}

/**
 * Set a user's emoji avatar icon. Clears any uploaded photo (deleting the
 * user_avatars row and nulling avatar_updated_at) — a photo and an icon are
 * mutually exclusive. The caller is responsible for validating `icon` with
 * sanitizeAvatarIcon first.
 */
export async function setAvatarIcon(userId: string, icon: string): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
		await tx
			.update(users)
			.set({ avatarIcon: icon, avatarUpdatedAt: null })
			.where(eq(users.id, userId));
	});
}

/** Fetch stored avatar bytes, or null if the user has no uploaded photo. */
export async function getAvatar(userId: string): Promise<StoredAvatar | null> {
	const [row] = await db
		.select({
			data: userAvatars.data,
			contentType: userAvatars.contentType,
			updatedAt: userAvatars.updatedAt
		})
		.from(userAvatars)
		.where(eq(userAvatars.userId, userId));
	return row ?? null;
}

/**
 * Remove a user's custom avatar — both an uploaded photo and an emoji icon —
 * reverting them to the generated initials.
 */
export async function clearAvatar(userId: string): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
		await tx
			.update(users)
			.set({ avatarUpdatedAt: null, avatarIcon: null })
			.where(eq(users.id, userId));
	});
}
