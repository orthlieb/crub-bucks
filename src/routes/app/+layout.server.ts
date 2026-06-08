import { redirect } from '@sveltejs/kit';
import {
	countIncomingRequests,
	userActivity,
	betSoundSignals,
	userBalance
} from '$lib/server/ledger';
import { listActiveForUser } from '$lib/server/notifications';
import { latestBadgeAt } from '$lib/server/badges';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, depends }) => {
	if (!locals.user) throw redirect(302, '/login');
	// Lets the client poll just this loader (sound cues / notifications / friend
	// request count) via invalidate('app:activity') without re-running page loads.
	depends('app:activity');
	const [pendingFriendRequests, notifications, activity, betSignals, balance, badgeAt] =
		await Promise.all([
			countIncomingRequests(locals.user.id).catch(() => 0),
			listActiveForUser(locals.user.id).catch(() => []),
			// Newest ledger entry for this user — drives the gain (cash) / lose (slide)
			// cues. The client decides whether it's new to them.
			userActivity(locals.user.id, 1).catch(() => []),
			// Newest "went live" / "cancelled" bet timestamps — drive the yes/no cues.
			betSoundSignals(locals.user.id).catch(() => ({ lastLiveAt: null, lastCancelledAt: null })),
			// Shown in the header next to the brand.
			userBalance(locals.user.id).catch(() => 0),
			// Newest badge earned — drives the "wow" award cue.
			latestBadgeAt(locals.user.id).catch(() => null)
		]);

	const latest = activity[0] ?? null;
	const sound = {
		// gain/lose
		lastTransferId: latest?.transferId ?? null,
		lastDelta: latest?.delta ?? 0,
		lastActivityAt: latest?.createdAt ?? null,
		// bet on/off
		lastBetLiveAt: betSignals.lastLiveAt,
		lastBetCancelledAt: betSignals.lastCancelledAt,
		// award earned
		lastBadgeAt: badgeAt
	};

	return { user: locals.user, pendingFriendRequests, notifications, sound, balance };
};
