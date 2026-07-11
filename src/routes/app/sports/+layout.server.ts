import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

// Sports betting is hidden. The routes, data, and settle cron stay intact
// (reversible), but the UI is unreachable — every /app/sports/* page bounces
// to the app home. Remove this file to bring the feature back.
export const load: LayoutServerLoad = () => {
	throw redirect(307, '/app');
};
