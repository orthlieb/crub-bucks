import { fail, type RequestEvent } from '@sveltejs/kit';
import {
	listTasksForUser,
	createTask,
	claimTask,
	releaseTask,
	submitTask,
	approveTask,
	rejectTask,
	archiveTask,
	TaskError,
	type Cadence
} from '$lib/server/tasks';
import { userBalance } from '$lib/server/ledger';
import { checkClean } from '$lib/server/moderation';
import { wholeCbToCoins } from '$lib/money';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const [lists, balance] = await Promise.all([listTasksForUser(userId), userBalance(userId)]);
	return { ...lists, balance };
};

const CADENCES = ['daily', 'weekly', 'monthly'];

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
		const cadenceRaw = String(form.get('cadence') ?? '');
		const cadence = CADENCES.includes(cadenceRaw) ? (cadenceRaw as Cadence) : null;

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
				cadence
			});
		} catch (e) {
			if (e instanceof TaskError) return fail(400, { createError: e.message, title, notes });
			throw e;
		}
		return { created: true as const };
	},

	claim: taskAction(claimTask),
	release: taskAction(releaseTask),
	submit: taskAction(submitTask),
	approve: taskAction(approveTask),
	reject: taskAction(rejectTask),
	archive: taskAction(archiveTask)
};
