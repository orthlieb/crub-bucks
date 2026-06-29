import { fail, redirect } from '@sveltejs/kit';
import {
	findUserByQrToken,
	areFriends,
	establishFriendship,
	LedgerError
} from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

/**
 * QR / share-link landing. The token is checked BEFORE any auth redirect so an
 * invalid code shows recovery copy rather than bouncing through login. A
 * logged-out visitor is sent to /login with a returnTo back here (the session
 * cookie survives the cross-site tap thanks to SameSite=Lax). No state is
 * mutated in `load` — the write happens in the POST confirm action.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
	const target = await findUserByQrToken(params.token);
	if (!target) return { status: 'invalid' as const };

	if (!locals.user) {
		throw redirect(302, `/login?returnTo=${encodeURIComponent(`/add/${params.token}`)}`);
	}
	if (target.id === locals.user.id) return { status: 'self' as const };
	if (await areFriends(locals.user.id, target.id)) {
		return { status: 'already' as const, name: target.displayName };
	}
	return { status: 'confirm' as const, name: target.displayName };
};

export const actions: Actions = {
	confirm: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, `/login?returnTo=${encodeURIComponent(`/add/${params.token}`)}`);
		}
		// Re-resolve the target from the token (never trust a client-supplied id).
		const target = await findUserByQrToken(params.token);
		if (target && target.id !== locals.user.id) {
			try {
				await establishFriendship(locals.user.id, target.id);
			} catch (e) {
				if (e instanceof LedgerError) return fail(400, { message: e.message });
				throw e;
			}
		}
		throw redirect(303, '/app/friends');
	}
};
