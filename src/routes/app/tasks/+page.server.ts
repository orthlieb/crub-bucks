import { fail, type RequestEvent } from '@sveltejs/kit';
import {
	listTasksForUser,
	createTask,
	editTask,
	claimTask,
	releaseTask,
	submitTask,
	approveTask,
	rejectTask,
	archiveTask,
	TaskError,
	type RecurrenceInput
} from '$lib/server/tasks';
import { userBalance, getFriends } from '$lib/server/ledger';
import { checkClean } from '$lib/server/moderation';
import { wholeCbToCoins } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [lists, balance, friends] = await Promise.all([
		listTasksForUser(userId),
		userBalance(userId),
		getFriends(userId)
	]);
	// Just what the "limit to specific friends" picker needs.
	return {
		...lists,
		balance,
		friends: friends.map((f) => ({ id: f.id, displayName: f.displayName }))
	};
};

/**
 * Selected friend ids for the claim-audience picker. Empty → no restriction
 * (open to all friends). `editTask`/`createTask` re-validate against the
 * creator's real friend list, so this is just shaping.
 */
function parseAudience(form: FormData): string[] {
	return form.getAll('audience').map(String).filter(Boolean);
}

/**
 * Pull the recurrence picker fields out of a submitted form into a
 * `RecurrenceInput`. Validation of the combination lives in `buildRecurrence`;
 * here we only shape the raw strings. Returns null when nothing was selected.
 */
function parseRecurrence(form: FormData): RecurrenceInput | null {
	const mode = String(form.get('mode') ?? '');
	if (!mode) return null;
	const num = (name: string): number | undefined => {
		const raw = form.get(name);
		if (raw === null || String(raw).trim() === '') return undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	};
	return {
		mode: mode as RecurrenceInput['mode'],
		weekdays: form.getAll('weekdays').map(String),
		monthday: num('monthday'),
		nthPos: num('nthPos'),
		nthWeekday: String(form.get('nthWeekday') ?? '') || undefined,
		month: num('month'),
		interval: num('interval'),
		customFreq: (String(form.get('customFreq') ?? '') ||
			undefined) as RecurrenceInput['customFreq'],
		endMode: (String(form.get('endMode') ?? '') || undefined) as RecurrenceInput['endMode'],
		count: num('count'),
		until: String(form.get('until') ?? '') || undefined
	};
}

/** Shared handler for the taskId-only actions (claim/release/submit/approve/reject/archive). */
function taskAction(fn: (taskId: string, userId: string) => Promise<void>) {
	return async ({ request, locals }: RequestEvent) => {
		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		try {
			await fn(taskId, locals.user!.id);
		} catch (e) {
			if (e instanceof TaskError) return fail(400, { taskError: e.message });
			throw e;
		}
		return { ok: true as const };
	};
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const form = await request.formData();
		const title = String(form.get('title') ?? '').trim();
		const notes = String(form.get('notes') ?? '').trim() || null;
		const price = wholeCbToCoins(form.get('price'));
		const recurring = form.get('recurring') !== null;
		const recurrence = recurring ? parseRecurrence(form) : null;

		const titleClean = checkClean(title, 'title');
		if (!titleClean.ok) return fail(400, { createError: titleClean.message, title, notes });
		const notesClean = checkClean(notes, 'notes');
		if (!notesClean.ok) return fail(400, { createError: notesClean.message, title, notes });
		if (price === null) {
			return fail(400, { createError: 'Enter a positive whole-CB price.', title, notes });
		}

		try {
			await createTask({
				creatorId: locals.user!.id,
				title,
				notes,
				price,
				recurring,
				recurrence,
				audience: parseAudience(form)
			});
		} catch (e) {
			if (e instanceof TaskError) return fail(400, { createError: e.message, title, notes });
			throw e;
		}
		return { created: true as const };
	},

	edit: async ({ request, locals }) => {
		const form = await request.formData();
		const taskId = String(form.get('taskId') ?? '');
		// `full` marks the open-task form (all fields); otherwise it's notes-only.
		const full = form.get('full') !== null;

		const patch: Parameters<typeof editTask>[2] = {};
		if (form.has('notes')) patch.notes = String(form.get('notes') ?? '').trim() || null;
		if (full) {
			patch.title = String(form.get('title') ?? '').trim();
			const p = wholeCbToCoins(form.get('price'));
			if (p === null) return fail(400, { taskError: 'Enter a positive whole-CB price.' });
			patch.price = p;
			patch.recurring = form.get('recurring') !== null;
			patch.recurrence = patch.recurring ? parseRecurrence(form) : null;
			patch.audience = parseAudience(form);
		}

		if (patch.title !== undefined) {
			const c = checkClean(patch.title, 'title');
			if (!c.ok) return fail(400, { taskError: c.message });
		}
		if (patch.notes !== undefined) {
			const c = checkClean(patch.notes, 'notes');
			if (!c.ok) return fail(400, { taskError: c.message });
		}

		try {
			await editTask(taskId, locals.user!.id, patch);
		} catch (e) {
			if (e instanceof TaskError) return fail(400, { taskError: e.message });
			throw e;
		}
		return { ok: true as const };
	},

	claim: taskAction(claimTask),
	release: taskAction(releaseTask),
	submit: taskAction(submitTask),
	approve: taskAction(approveTask),
	reject: taskAction(rejectTask),
	archive: taskAction(archiveTask)
};
