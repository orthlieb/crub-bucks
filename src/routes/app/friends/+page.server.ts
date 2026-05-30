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
	userBalance,
	LedgerError
} from '$lib/server/ledger';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [friends, incoming, outgoing, invites, balance] = await Promise.all([
		getFriends(userId),
		getIncomingRequests(userId),
		getOutgoingRequests(userId),
		getPendingInvites(userId),
		userBalance(userId)
	]);
	return { friends, incoming, outgoing, invites, balance };
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

	pay: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const toUserId = String(form.get('toUserId') ?? '');
		const amount = Number(form.get('amount'));
		const memo = String(form.get('memo') ?? '').trim() || null;

		if (!toUserId || toUserId === userId) {
			return fail(400, { payError: 'Pick a friend to pay.' });
		}
		if (!(await areFriends(userId, toUserId))) {
			return fail(400, { payError: 'You can only pay your friends.' });
		}

		try {
			await transferBetweenUsers({ fromUserId: userId, toUserId, amount, memo, createdBy: userId });
		} catch (e) {
			if (e instanceof LedgerError) return fail(400, { payError: e.message });
			throw e;
		}
		return { paid: true };
	}
};
