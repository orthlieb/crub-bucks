import { fail } from '@sveltejs/kit';
import {
	createNotification,
	deleteNotification,
	listAllForAdmin,
	type NotificationLevel
} from '$lib/server/notifications';
import { logSecurityEvent } from '$lib/server/auth/audit';
import { sendWebPush, pushConfigured } from '$lib/server/push';
import type { Actions, PageServerLoad } from './$types';

const LEVELS: NotificationLevel[] = ['info', 'success', 'warning'];

export const load: PageServerLoad = async () => {
	const items = await listAllForAdmin(100);
	return { items };
};

export const actions: Actions = {
	send: async (event) => {
		const actor = event.locals.user?.id ?? null;
		const form = await event.request.formData();
		const title = String(form.get('title') ?? '').trim();
		const body = String(form.get('body') ?? '').trim() || null;
		const level = String(form.get('level') ?? 'info') as NotificationLevel;
		const target = String(form.get('target') ?? 'broadcast');
		const userId = String(form.get('userId') ?? '').trim() || null;

		if (!title) return fail(400, { error: 'Title is required.' });
		if (!LEVELS.includes(level)) return fail(400, { error: 'Invalid level.' });
		if (target !== 'broadcast' && target !== 'user') {
			return fail(400, { error: 'Invalid target.' });
		}
		if (target === 'user' && !userId) {
			return fail(400, { error: 'Pick a recipient.' });
		}

		const id = await createNotification({
			level,
			title,
			body,
			userId: target === 'user' ? userId : null,
			createdBy: actor
		});

		await logSecurityEvent({
			userId: actor,
			eventType: 'notification_sent',
			event,
			metadata: {
				notificationId: id,
				level,
				broadcast: target === 'broadcast',
				targetUserId: target === 'user' ? userId : null,
				title
			}
		});

		return { ok: 'sent' as const };
	},

	// Send a Web Push to the admin's own subscribed devices — verifies the push
	// pipeline end-to-end without creating an in-app notification.
	testPush: async (event) => {
		const actor = event.locals.user;
		if (!actor) return fail(401, { pushError: 'Not signed in.' });
		if (!pushConfigured()) {
			return fail(400, { pushError: 'Push is not configured (missing VAPID env).' });
		}
		const count = await sendWebPush(actor.id, {
			title: '🔔 Test push',
			body: 'If you can see this, Crub Bucks push notifications are working.',
			url: '/app'
		});
		return {
			pushResult:
				count > 0
					? `Test push sent to ${count} device${count === 1 ? '' : 's'}.`
					: 'No subscribed devices for your account — enable Notifications in Settings (in a real browser) first.'
		};
	},

	delete: async (event) => {
		const actor = event.locals.user?.id ?? null;
		const form = await event.request.formData();
		const id = String(form.get('id') ?? '').trim();
		if (!id) return fail(400, { error: 'Missing id.' });

		await deleteNotification(id);
		await logSecurityEvent({
			userId: actor,
			eventType: 'notification_deleted',
			event,
			metadata: { notificationId: id }
		});

		return { ok: 'deleted' as const };
	}
};
