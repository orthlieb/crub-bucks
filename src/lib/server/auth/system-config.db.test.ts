import { describe, it, expect, beforeEach } from 'vitest';
import { getSystemConfig, bumpAssetVersion } from './system-config';
import { hasTestDb, resetDb } from '../../../test/db';

const suite = hasTestDb ? describe : describe.skip;

suite('system config asset version', () => {
	beforeEach(async () => {
		await resetDb();
	});

	it('defaults to 1 and increments on each bump', async () => {
		// Lazy-init on first read gives the starting version.
		const before = await getSystemConfig();
		expect(before.assetVersion).toBe(1);

		const v2 = await bumpAssetVersion(null);
		expect(v2).toBe(2);
		expect((await getSystemConfig()).assetVersion).toBe(2);

		const v3 = await bumpAssetVersion(null);
		expect(v3).toBe(3);
		expect((await getSystemConfig()).assetVersion).toBe(3);
	});

	it('bumps even when the row was never explicitly read first', async () => {
		// No prior getSystemConfig() — bump must self-seed the singleton row.
		const v = await bumpAssetVersion(null);
		expect(v).toBe(2);
	});
});
