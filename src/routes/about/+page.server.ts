import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// The About content now lives on the home page (single long-form page).
// Redirect any /about links, bookmarks, or the app header ₡ icon to it.
export const load: PageServerLoad = () => {
	throw redirect(308, '/');
};
