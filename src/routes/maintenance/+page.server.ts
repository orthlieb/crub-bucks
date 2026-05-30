import { getSystemConfig } from '$lib/server/auth/system-config';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const cfg = await getSystemConfig();
	return {
		active: cfg.maintenanceMode,
		message: cfg.maintenanceMessage
	};
};
