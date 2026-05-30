import { error, fail, redirect } from '@sveltejs/kit';
import { dismissForUser } from '$lib/server/notifications';
import type { Actions, PageServerLoad } from './$types';

// The page itself isn't navigable — it only exists as a target for the
// dismiss form action attached to the in-layout notification banners.
export const load: PageServerLoad = () => {
	throw redirect(303, '/app');
};

export const actions: Actions = {
	dismiss: async ({ request, locals }) => {
		const userId = locals.user?.id;
		if (!userId) throw error(401, 'Not signed in');
		const form = await request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Missing notification id.' });

		await dismissForUser(id, userId);

		// Send the user back to the page they were on. The form sets a
		// `from` field so we don't rely on Referer (which JS-disabled fetches
		// may strip).
		const from = String(form.get('from') ?? '/app').trim() || '/app';
		throw redirect(303, from);
	}
};
