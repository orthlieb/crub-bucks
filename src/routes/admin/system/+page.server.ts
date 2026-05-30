import { fail } from '@sveltejs/kit';
import { getSystemConfig, updateSystemConfig } from '$lib/server/auth/system-config';
import { logSecurityEvent } from '$lib/server/auth/audit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const config = await getSystemConfig();
	return { config };
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
	}
};
