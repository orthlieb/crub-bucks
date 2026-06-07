import { fail, redirect } from '@sveltejs/kit';
import { sendReportEmail } from '$lib/server/email';
import { logSecurityEvent } from '$lib/server/auth/audit';
import type { Actions, PageServerLoad } from './$types';

// No standalone page — this route exists only for its report action, which
// other pages post to via <form action="/app/report">. A direct visit bounces
// back to the app.
export const load: PageServerLoad = async () => {
	throw redirect(302, '/app');
};

const TYPES = new Set(['user', 'bet']);

export const actions: Actions = {
	default: async (event) => {
		const me = event.locals.user;
		if (!me) return fail(401, { error: 'Please sign in.' });

		const form = await event.request.formData();
		const targetType = String(form.get('targetType') ?? '');
		const targetId = String(form.get('targetId') ?? '').trim();
		const targetLabel = String(form.get('targetLabel') ?? '').trim();
		const content = String(form.get('content') ?? '').trim() || null;
		const reason = String(form.get('reason') ?? '').trim().slice(0, 500) || null;

		if (!TYPES.has(targetType) || !targetId) {
			return fail(400, { error: "We couldn't tell what you're reporting." });
		}

		// Durable audit record (email is best-effort and may be console-only in dev).
		await logSecurityEvent({
			userId: me.id,
			eventType: 'content_reported',
			event,
			metadata: { targetType, targetId, targetLabel, content, reason }
		});

		try {
			await sendReportEmail({
				reporterName: me.displayName,
				reporterEmail: me.email,
				reporterId: me.id,
				targetType: targetType as 'user' | 'bet',
				targetId,
				targetLabel,
				content,
				reason
			});
		} catch (err) {
			// The report is already logged; a mail hiccup shouldn't show the user
			// an error (we still have the audit row to act on).
			console.warn('[report] email send failed:', err);
		}

		return { reported: true as const };
	}
};
