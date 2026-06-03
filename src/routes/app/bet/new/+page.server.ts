import { fail, redirect } from '@sveltejs/kit';
import { createBet, getFriends, LedgerError } from '$lib/server/ledger';
import type { BetMode } from '$lib/ledger-math';
import type { Actions, PageServerLoad } from './$types';

// 'custom' is intentionally excluded — custom bets can no longer be created
// (existing ones still resolve/display via the ledger).
const MODES: BetMode[] = ['even_split', 'winner_loser', 'tiered', 'pot'];

// Cap the icon at 8 chars to allow for multi-codepoint emoji (skin tones,
// ZWJ sequences) while keeping it well away from "user pasted a paragraph."
const MAX_ICON_LEN = 8;

function parseIcon(raw: FormDataEntryValue | null): string | null {
	const s = String(raw ?? '').trim();
	if (!s) return null;
	return s.slice(0, MAX_ICON_LEN);
}

export const load: PageServerLoad = async ({ locals }) => {
	const friends = await getFriends(locals.user!.id);
	return {
		friends,
		me: { id: locals.user!.id, displayName: locals.user!.displayName }
	};
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const icon = parseIcon(form.get('icon'));
		const mode = String(form.get('mode') ?? '') as BetMode;
		if (!MODES.includes(mode)) {
			return fail(400, { error: 'Pick a bet type.', title, icon });
		}

		try {
			let betId: string;
			if (mode === 'pot') {
				const stake = Number(form.get('stake'));
				const selected = form.getAll('participantId').map(String).filter(Boolean);
				const participantIds = Array.from(new Set([userId, ...selected]));
				betId = await createBet({
					mode,
					title,
					icon,
					createdBy: userId,
					stake,
					participantIds
				});
			} else {
				const pool = Number(form.get('amount'));
				// Creator is always in; plus the friends they checked.
				const selected = form.getAll('participantId').map(String).filter(Boolean);
				const participantIds = Array.from(new Set([userId, ...selected]));
				betId = await createBet({
					mode,
					title,
					icon,
					createdBy: userId,
					pool,
					participantIds
				});
			}
			throw redirect(303, `/app/bet/${betId}`);
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { error: e.message, title, icon });
			throw e;
		}
	}
};
