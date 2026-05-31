import { fail } from '@sveltejs/kit';
import { getSystemConfig, updateSystemConfig } from '$lib/server/auth/system-config';
import { countRegistrationsToday, logSecurityEvent } from '$lib/server/auth/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const [config, registrationsToday] = await Promise.all([
		getSystemConfig(),
		countRegistrationsToday()
	]);
	return { config, registrationsToday };
};

export const actions: Actions = {
	maintenance: async (event) => {
		const form = await event.request.formData();
		const enabled = form.get('enabled') === 'on';
		const message = String(form.get('message') ?? '').trim() || null;
		const actor = event.locals.user?.id ?? null;

		await updateSystemConfig(
			{ maintenanceMode: enabled, maintenanceMessage: message },
			actor
		);
		await logSecurityEvent({
			userId: actor,
			eventType: 'maintenance_mode_change',
			event,
			metadata: { enabled, message }
		});
		return { ok: 'maintenance' as const };
	},

	registrationLock: async (event) => {
		const form = await event.request.formData();
		const enabled = form.get('enabled') === 'on';
		const message = String(form.get('message') ?? '').trim() || null;
		const actor = event.locals.user?.id ?? null;

		await updateSystemConfig(
			{ registrationLock: enabled, registrationLockMessage: message },
			actor
		);
		await logSecurityEvent({
			userId: actor,
			eventType: 'registration_lock_change',
			event,
			metadata: { enabled, message }
		});
		return { ok: 'registrationLock' as const };
	},

	registrationDailyLimit: async (event) => {
		const form = await event.request.formData();
		const raw = String(form.get('limit') ?? '').trim();
		const message = String(form.get('message') ?? '').trim() || null;
		const actor = event.locals.user?.id ?? null;

		// Blank input → unlimited (null). Otherwise must be a non-negative
		// integer; 0 is allowed and means "no new signups today" (functionally
		// like a registration lock, but tracked as a quota).
		let limit: number | null = null;
		if (raw !== '') {
			const n = Number(raw);
			if (!Number.isInteger(n) || n < 0) {
				return fail(400, {
					error: 'Daily limit must be a whole number ≥ 0, or blank for unlimited.'
				});
			}
			limit = n;
		}

		await updateSystemConfig(
			{ registrationDailyLimit: limit, registrationDailyLimitMessage: message },
			actor
		);
		await logSecurityEvent({
			userId: actor,
			eventType: 'registration_daily_limit_change',
			event,
			metadata: { limit, message }
		});
		return { ok: 'registrationDailyLimit' as const };
	}
};
