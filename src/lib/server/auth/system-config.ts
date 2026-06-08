import { eq } from 'drizzle-orm';
import { db } from '../db';
import { systemConfig } from '../db/schema';

/**
 * Singleton system_config row. id is always 'system'; the helpers below
 * lazily insert on first read so callers don't have to seed it.
 *
 * Updates go through updateSystemConfig() which patches the row and
 * stamps updatedAt / updatedBy.
 */

const SYSTEM_KEY = 'system';

export interface SystemConfig {
	maintenanceMode: boolean;
	maintenanceMessage: string | null;
	registrationLock: boolean;
	registrationLockMessage: string | null;
	/**
	 * Soft cap on successful signups per calendar day. null = no cap.
	 * Enforced in the registration action; admin sets it on /admin/system.
	 */
	registrationDailyLimit: number | null;
	registrationDailyLimitMessage: string | null;
	updatedAt: Date;
	updatedBy: string | null;
}

export async function getSystemConfig(): Promise<SystemConfig> {
	const [row] = await db
		.select()
		.from(systemConfig)
		.where(eq(systemConfig.id, SYSTEM_KEY))
		.limit(1);
	if (row) {
		return {
			maintenanceMode: row.maintenanceMode,
			maintenanceMessage: row.maintenanceMessage,
			registrationLock: row.registrationLock,
			registrationLockMessage: row.registrationLockMessage,
			registrationDailyLimit: row.registrationDailyLimit,
			registrationDailyLimitMessage: row.registrationDailyLimitMessage,
			updatedAt: row.updatedAt,
			updatedBy: row.updatedBy
		};
	}
	// Lazy init.
	const now = new Date();
	await db
		.insert(systemConfig)
		.values({
			id: SYSTEM_KEY,
			maintenanceMode: false,
			maintenanceMessage: null,
			registrationLock: false,
			registrationLockMessage: null,
			registrationDailyLimit: null,
			registrationDailyLimitMessage: null,
			updatedAt: now,
			updatedBy: null
		})
		.onConflictDoNothing();
	return {
		maintenanceMode: false,
		maintenanceMessage: null,
		registrationLock: false,
		registrationLockMessage: null,
		registrationDailyLimit: null,
		registrationDailyLimitMessage: null,
		updatedAt: now,
		updatedBy: null
	};
}

export interface SystemConfigPatch {
	maintenanceMode?: boolean;
	maintenanceMessage?: string | null;
	registrationLock?: boolean;
	registrationLockMessage?: string | null;
	registrationDailyLimit?: number | null;
	registrationDailyLimitMessage?: string | null;
}

export async function updateSystemConfig(
	patch: SystemConfigPatch,
	updatedBy: string | null
): Promise<void> {
	// Ensure the row exists.
	await getSystemConfig();
	await db
		.update(systemConfig)
		.set({ ...patch, updatedAt: new Date(), updatedBy })
		.where(eq(systemConfig.id, SYSTEM_KEY));
}
