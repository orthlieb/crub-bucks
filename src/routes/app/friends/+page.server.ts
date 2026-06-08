import { fail } from '@sveltejs/kit';
import {
	getFriends,
	getIncomingRequests,
	getOutgoingRequests,
	getPendingInvites,
	sendFriendRequest,
	acceptFriendRequest,
	denyFriendRequest,
	cancelFriendRequest,
	cancelInvite,
	unfriend,
	transferBetweenUsers,
	areFriends,
	setFavorite,
	LedgerError
} from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [friends, incoming, outgoing, invites] = await Promise.all([
		getFriends(userId),
		getIncomingRequests(userId),
		getOutgoingRequests(userId),
		getPendingInvites(userId)
	]);
	return { friends, incoming, outgoing, invites };
};

export const actions: Actions = {
	request: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const email = String(form.get('email') ?? '');
		try {
			const { result } = await sendFriendRequest(userId, email);
			const messages: Record<typeof result, string> = {
				sent: 'Friend request sent.',
				accepted: "They'd already requested you — you're now friends!",
				already: "You're already friends.",
				already_sent: 'Request already pending.',
				invited: `No account for ${email} yet — we emailed them an invite to join.`,
				already_invited: `You've already invited ${email}. We'll connect you when they join.`
			};
			return { requestMessage: messages[result] };
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { requestError: e.message, email });
			throw e;
		}
	},

	cancelInvite: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const inviteId = String(form.get('inviteId') ?? '');
		await cancelInvite(userId, inviteId);
		return { inviteCancelled: true };
	},

	accept: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const requestId = String(form.get('requestId') ?? '');
		try {
			await acceptFriendRequest(userId, requestId);
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { requestError: e.message });
			throw e;
		}
		return { accepted: true };
	},

	deny: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const requestId = String(form.get('requestId') ?? '');
		await denyFriendRequest(userId, requestId);
		return { denied: true };
	},

	cancel: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const requestId = String(form.get('requestId') ?? '');
		await cancelFriendRequest(userId, requestId);
		return { cancelled: true };
	},

	unfriend: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const friendId = String(form.get('friendId') ?? '');
		await unfriend(userId, friendId);
		return { unfriended: true };
	},

	favorite: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const friendId = String(form.get('friendId') ?? '');
		// Form sends the *desired* end state, not a toggle, so the server is
		// authoritative if two tabs disagree.
		const desired = form.get('isFavorite') === 'true';
		try {
			await setFavorite(userId, friendId, desired);
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { favoriteError: e.message });
			throw e;
		}
		return { favoriteToggled: true };
	},

	pay: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const toUserId = String(form.get('toUserId') ?? '');
		const amount = Number(form.get('amount'));
		const memo = String(form.get('memo') ?? '').trim() || null;
		// Cap at 8 chars to allow multi-codepoint emoji (skin tones, ZWJ) while
		// preventing prose abuse.
		const icon =
			String(form.get('icon') ?? '')
				.trim()
				.slice(0, 8) || null;

		if (!toUserId || toUserId === userId) {
			return fail(400, { payError: 'Pick a friend to pay.' });
		}
		if (!(await areFriends(userId, toUserId))) {
			return fail(400, { payError: 'You can only pay your friends.' });
		}

		try {
			await transferBetweenUsers({
				fromUserId: userId,
				toUserId,
				amount,
				memo,
				icon,
				createdBy: userId
			});
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { payError: e.message });
			throw e;
		}
		return { paid: true };
	}
};
