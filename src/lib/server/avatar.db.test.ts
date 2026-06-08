import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { users } from '$lib/server/db/schema';
import { setAvatar, setAvatarIcon, clearAvatar, getAvatar } from './avatar';
import { hasTestDb, resetDb, createUser } from '../../test/db';

const suite = hasTestDb ? describe : describe.skip;

// A minimal valid PNG header so sniffImageType-style checks elsewhere are happy;
// setAvatar itself trusts the caller's type, so any bytes work here.
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function avatarFlags(userId: string) {
	const [u] = await db
		.select({ avatarIcon: users.avatarIcon, avatarUpdatedAt: users.avatarUpdatedAt })
		.from(users)
		.where(eq(users.id, userId));
	const photo = await getAvatar(userId);
	return { ...u, hasPhotoRow: photo !== null };
}

suite('avatar storage (DB)', () => {
	beforeEach(async () => {
		await resetDb();
	});

	it('setAvatarIcon stores the emoji and leaves no photo', async () => {
		const u = await createUser();
		await setAvatarIcon(u.id, '🦊');
		const f = await avatarFlags(u.id);
		expect(f.avatarIcon).toBe('🦊');
		expect(f.avatarUpdatedAt).toBeNull();
		expect(f.hasPhotoRow).toBe(false);
	});

	it('uploading a photo clears a previously-set icon (mutually exclusive)', async () => {
		const u = await createUser();
		await setAvatarIcon(u.id, '🦊');
		await setAvatar(u.id, PNG_BYTES, 'image/png');
		const f = await avatarFlags(u.id);
		expect(f.avatarIcon).toBeNull();
		expect(f.avatarUpdatedAt).not.toBeNull();
		expect(f.hasPhotoRow).toBe(true);
	});

	it('setting an icon clears a previously-uploaded photo (mutually exclusive)', async () => {
		const u = await createUser();
		await setAvatar(u.id, PNG_BYTES, 'image/png');
		await setAvatarIcon(u.id, '🎲');
		const f = await avatarFlags(u.id);
		expect(f.avatarIcon).toBe('🎲');
		expect(f.avatarUpdatedAt).toBeNull();
		expect(f.hasPhotoRow).toBe(false);
	});

	it('clearAvatar removes both a photo and an icon', async () => {
		const u = await createUser();
		await setAvatarIcon(u.id, '🦊');
		await clearAvatar(u.id);
		let f = await avatarFlags(u.id);
		expect(f.avatarIcon).toBeNull();
		expect(f.hasPhotoRow).toBe(false);

		await setAvatar(u.id, PNG_BYTES, 'image/png');
		await clearAvatar(u.id);
		f = await avatarFlags(u.id);
		expect(f.avatarUpdatedAt).toBeNull();
		expect(f.hasPhotoRow).toBe(false);
	});
});
