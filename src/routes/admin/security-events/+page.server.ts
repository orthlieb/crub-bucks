import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { securityEvents, users } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

const PAGE_SIZE = 100;
const KNOWN_TYPES = [
	'register',
	'email_verified',
	'login_success',
	'login_failure',
	'logout',
	'lockout',
	'password_reset_requested',
	'password_reset_completed',
	'admin_role_change',
	'admin_suspend',
	'admin_unsuspend',
	'maintenance_mode_change',
	'registration_lock_change',
	'notification_sent',
	'notification_deleted'
] as const;

export const load: PageServerLoad = async ({ url }) => {
	const typeFilter = url.searchParams.get('type') ?? '';

	const baseQuery = db
		.select({
			id: securityEvents.id,
			createdAt: securityEvents.createdAt,
			eventType: securityEvents.eventType,
			ipAddress: securityEvents.ipAddress,
			userAgent: securityEvents.userAgent,
			metadata: securityEvents.metadata,
			userId: securityEvents.userId,
			userEmail: users.email,
			userDisplayName: users.displayName
		})
		.from(securityEvents)
		.leftJoin(users, eq(users.id, securityEvents.userId))
		.orderBy(desc(securityEvents.createdAt))
		.limit(PAGE_SIZE);

	const events =
		typeFilter && KNOWN_TYPES.includes(typeFilter as (typeof KNOWN_TYPES)[number])
			? await baseQuery.where(eq(securityEvents.eventType, typeFilter))
			: await baseQuery;

	return {
		events,
		typeFilter,
		availableTypes: KNOWN_TYPES,
		pageSize: PAGE_SIZE
	};
};
