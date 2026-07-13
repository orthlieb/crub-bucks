import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import { db } from './db';
import { tasks, taskCompletions, taskAudience, users, friendships } from './db/schema';
import { getOrCreateUserWallet, transferInTx, areFriends } from './ledger';
import { evaluateBadges } from './badges';
import { createNotification } from './notifications';
import {
	buildRecurrence,
	nextOccurrenceAfter,
	recurrenceLabel,
	RecurrenceError,
	type RecurrenceInput
} from './recurrence';
import { formatAmount } from '../format';

/**
 * Chore marketplace. A creator posts a task with a CB price; any of their
 * friends can CLAIM it, then mark it DONE (submitted); the creator APPROVES,
 * which pays the price creator → claimer via the ledger (no escrow — CB moves
 * only on approval). One-time tasks archive after approval; recurring tasks
 * return to 'open'. All friendship/ownership guards live here.
 */

export class TaskError extends Error {}

// Re-export so route code can accept a recurrence picker payload.
export type { RecurrenceInput } from './recurrence';

/** Accepted-friend user ids of `userId` (either direction). */
async function friendIds(userId: string): Promise<string[]> {
	const other = sql<string>`case when ${friendships.requesterId} = ${userId} then ${friendships.addresseeId} else ${friendships.requesterId} end`;
	const rows = await db
		.select({ id: other })
		.from(friendships)
		.where(
			and(
				eq(friendships.status, 'accepted'),
				or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))
			)
		);
	return rows.map((r) => r.id);
}

/**
 * Narrow a requested claim-audience to the creator's actual accepted friends
 * (deduped). An empty result means "no restriction" — the task stays open to
 * all friends. This is the guard against a tampered form naming non-friends.
 */
async function validAudience(
	creatorId: string,
	requested: string[] | null | undefined
): Promise<string[]> {
	if (!requested || requested.length === 0) return [];
	const friends = new Set(await friendIds(creatorId));
	return [...new Set(requested)].filter((id) => friends.has(id));
}

export async function createTask(opts: {
	creatorId: string;
	title: string;
	notes?: string | null;
	price: number; // coins
	recurring: boolean;
	recurrence?: RecurrenceInput | null;
	// Friend ids allowed to claim. Empty/omitted → open to all friends.
	audience?: string[] | null;
}): Promise<string> {
	const title = opts.title.trim();
	if (!title) throw new TaskError('Give the task a title.');
	if (!Number.isInteger(opts.price) || opts.price < 1) {
		throw new TaskError('Set a positive whole-CB price.');
	}

	// A recurring task carries a canonical rrule + its first due date; a one-time
	// task has neither. `buildRecurrence` throws RecurrenceError on bad input.
	let rrule: string | null = null;
	let nextDueAt: Date | null = null;
	if (opts.recurring) {
		if (!opts.recurrence) throw new TaskError('Choose how the task repeats.');
		try {
			const built = buildRecurrence(opts.recurrence, new Date());
			rrule = built.rrule;
			nextDueAt = built.nextDueAt;
		} catch (e) {
			if (e instanceof RecurrenceError) throw new TaskError(e.message);
			throw e;
		}
	}

	const audience = await validAudience(opts.creatorId, opts.audience);

	return db.transaction(async (tx) => {
		const [row] = await tx
			.insert(tasks)
			.values({
				creatorId: opts.creatorId,
				title,
				notes: opts.notes?.trim() || null,
				price: opts.price,
				recurring: opts.recurring,
				rrule,
				nextDueAt
			})
			.returning({ id: tasks.id });
		if (audience.length > 0) {
			await tx.insert(taskAudience).values(audience.map((userId) => ({ taskId: row.id, userId })));
		}
		return row.id;
	});
}

/**
 * Creator edits their task. While it's still `open` everything is editable
 * (title, notes, price, recurrence). Once it's claimed/submitted/done, only the
 * notes can change — the title, price, and terms are locked so they can't move
 * after someone signed up (archived tasks can't be edited at all).
 */
export async function editTask(
	taskId: string,
	creatorId: string,
	patch: {
		title?: string;
		notes?: string | null;
		price?: number;
		recurring?: boolean;
		recurrence?: RecurrenceInput | null;
		// Friend ids allowed to claim. [] → open to all friends.
		audience?: string[] | null;
	}
): Promise<void> {
	const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
	if (!t) throw new TaskError('Task not found.');
	if (t.creatorId !== creatorId) throw new TaskError('Only the creator can edit this task.');
	if (t.status === 'archived') throw new TaskError("You can't edit an archived task.");

	const set: Partial<typeof tasks.$inferInsert> = {};
	// Notes are editable in any non-archived state.
	if (patch.notes !== undefined) set.notes = patch.notes?.trim() || null;

	// The rest is only editable while nobody has claimed it.
	if (t.status === 'open') {
		if (patch.title !== undefined) {
			const title = patch.title.trim();
			if (!title) throw new TaskError('Give the task a title.');
			set.title = title;
		}
		if (patch.price !== undefined) {
			if (!Number.isInteger(patch.price) || patch.price < 1) {
				throw new TaskError('Set a positive whole-CB price.');
			}
			set.price = patch.price;
		}
		if (patch.recurring !== undefined) {
			set.recurring = patch.recurring;
			if (patch.recurring) {
				if (!patch.recurrence) throw new TaskError('Choose how the task repeats.');
				try {
					const built = buildRecurrence(patch.recurrence, new Date());
					set.rrule = built.rrule;
					set.nextDueAt = built.nextDueAt;
				} catch (e) {
					if (e instanceof RecurrenceError) throw new TaskError(e.message);
					throw e;
				}
			} else {
				set.rrule = null;
				set.nextDueAt = null;
			}
		}
	}

	// Audience is a "terms" change — only while open, like title/price. Validate
	// before opening the transaction so the read isn't tangled in it.
	const audienceChange = t.status === 'open' && patch.audience !== undefined;
	const audience = audienceChange ? await validAudience(creatorId, patch.audience) : [];

	if (Object.keys(set).length === 0 && !audienceChange) return;
	await db.transaction(async (tx) => {
		if (Object.keys(set).length > 0) {
			await tx.update(tasks).set(set).where(eq(tasks.id, taskId));
		}
		if (audienceChange) {
			await tx.delete(taskAudience).where(eq(taskAudience.taskId, taskId));
			if (audience.length > 0) {
				await tx.insert(taskAudience).values(audience.map((userId) => ({ taskId, userId })));
			}
		}
	});
}

/** A friend claims an open task. */
export async function claimTask(taskId: string, userId: string): Promise<void> {
	const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
	if (!t) throw new TaskError('Task not found.');
	if (t.creatorId === userId) throw new TaskError("You can't claim your own task.");
	if (t.status !== 'open') throw new TaskError('That task is no longer available.');
	if (!(await areFriends(userId, t.creatorId))) {
		throw new TaskError("You can only claim a friend's task.");
	}
	// When the task limits its audience, the claimer must be on the list.
	const audience = await db
		.select({ userId: taskAudience.userId })
		.from(taskAudience)
		.where(eq(taskAudience.taskId, taskId));
	if (audience.length > 0 && !audience.some((a) => a.userId === userId)) {
		throw new TaskError('This task is limited to certain friends.');
	}
	// Guarded transition so two people can't both claim.
	const res = await db
		.update(tasks)
		.set({ status: 'claimed', claimedBy: userId, claimedAt: new Date() })
		.where(and(eq(tasks.id, taskId), eq(tasks.status, 'open')))
		.returning({ id: tasks.id });
	if (res.length === 0) throw new TaskError('Someone just claimed that task.');

	const [claimer] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	await createNotification({
		userId: t.creatorId,
		level: 'info',
		title: `${claimer?.displayName ?? 'Someone'} claimed “${t.title}”`,
		body: "They'll mark it done when it's finished.",
		link: '/app/tasks'
	}).catch(() => {});
}

/** The claimer releases a task they can't finish (back to open). */
export async function releaseTask(taskId: string, userId: string): Promise<void> {
	const res = await db
		.update(tasks)
		.set({ status: 'open', claimedBy: null, claimedAt: null, submittedAt: null })
		.where(
			and(
				eq(tasks.id, taskId),
				eq(tasks.claimedBy, userId),
				inArray(tasks.status, ['claimed', 'submitted'])
			)
		)
		.returning({ id: tasks.id });
	if (res.length === 0) throw new TaskError("You can't release that task.");
}

/** The claimer marks it done — awaiting the creator's approval. */
export async function submitTask(taskId: string, userId: string): Promise<void> {
	const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
	if (!t) throw new TaskError('Task not found.');
	if (t.claimedBy !== userId || t.status !== 'claimed') {
		throw new TaskError("That task isn't yours to submit.");
	}
	await db
		.update(tasks)
		.set({ status: 'submitted', submittedAt: new Date() })
		.where(and(eq(tasks.id, taskId), eq(tasks.claimedBy, userId), eq(tasks.status, 'claimed')));

	const [claimer] = await db
		.select({ displayName: users.displayName })
		.from(users)
		.where(eq(users.id, userId))
		.limit(1);
	await createNotification({
		userId: t.creatorId,
		level: 'info',
		title: `${claimer?.displayName ?? 'Someone'} finished “${t.title}”`,
		body: `Approve to pay ${formatAmount(t.price)} ₡.`,
		link: '/app/tasks'
	}).catch(() => {});
}

/**
 * The creator approves a submitted task: pay the price claimer, record the
 * completion, and either archive (one-time) or reopen (recurring) — all in one
 * transaction so the money and the state change can't diverge.
 */
export async function approveTask(taskId: string, creatorId: string): Promise<void> {
	const result = await db.transaction(async (tx) => {
		const [t] = await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).for('update');
		if (!t) throw new TaskError('Task not found.');
		if (t.creatorId !== creatorId) throw new TaskError('Only the creator can approve.');
		if (t.status !== 'submitted' || !t.claimedBy) {
			throw new TaskError('That task is not awaiting approval.');
		}

		const fromWallet = await getOrCreateUserWallet(creatorId, tx);
		const toWallet = await getOrCreateUserWallet(t.claimedBy, tx);
		await transferInTx(tx, {
			fromWalletId: fromWallet,
			toWalletId: toWallet,
			amount: t.price,
			memo: `Task: ${t.title}`,
			createdBy: creatorId
		});

		await tx.insert(taskCompletions).values({
			taskId: t.id,
			taskeeId: t.claimedBy,
			price: t.price,
			approved: true
		});

		// Recurring → advance to the next occurrence strictly after now and reopen;
		// if the recurrence is exhausted (an end date/count that has passed), it's
		// finished like a one-time task. One-time → archived-as-done.
		if (t.recurring) {
			// Legacy recurring rows without an rrule just reopen indefinitely.
			const next = t.rrule ? nextOccurrenceAfter(t.rrule, new Date()) : null;
			if (!t.rrule || next) {
				await tx
					.update(tasks)
					.set({
						status: 'open',
						claimedBy: null,
						claimedAt: null,
						submittedAt: null,
						nextDueAt: next
					})
					.where(eq(tasks.id, t.id));
			} else {
				// Recurrence ran out — mark done and clear the stale due date.
				await tx.update(tasks).set({ status: 'done', nextDueAt: null }).where(eq(tasks.id, t.id));
			}
		} else {
			await tx.update(tasks).set({ status: 'done' }).where(eq(tasks.id, t.id));
		}

		return { taskeeId: t.claimedBy, price: t.price, title: t.title };
	});

	// Best-effort side effects (outside the money transaction).
	await createNotification({
		userId: result.taskeeId,
		level: 'success',
		title: `“${result.title}” approved`,
		body: `You earned ${formatAmount(result.price)} ₡.`,
		link: '/app/tasks'
	}).catch(() => {});
	await evaluateBadges(creatorId).catch(() => {});
}

/** The creator rejects a submitted task — records it and reopens for another go. */
export async function rejectTask(taskId: string, creatorId: string): Promise<void> {
	const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
	if (!t) throw new TaskError('Task not found.');
	if (t.creatorId !== creatorId) throw new TaskError('Only the creator can reject.');
	if (t.status !== 'submitted' || !t.claimedBy) {
		throw new TaskError('That task is not awaiting approval.');
	}
	const taskeeId = t.claimedBy;
	await db.insert(taskCompletions).values({
		taskId: t.id,
		taskeeId,
		price: t.price,
		approved: false
	});
	await db
		.update(tasks)
		.set({ status: 'open', claimedBy: null, claimedAt: null, submittedAt: null })
		.where(eq(tasks.id, t.id));

	await createNotification({
		userId: taskeeId,
		level: 'warning',
		title: `“${t.title}” wasn't approved`,
		body: 'It has been reopened — give it another go.',
		link: '/app/tasks'
	}).catch(() => {});
}

/** The creator retires a task (any non-terminal state). */
export async function archiveTask(taskId: string, creatorId: string): Promise<void> {
	const res = await db
		.update(tasks)
		.set({ status: 'archived', claimedBy: null })
		.where(
			and(
				eq(tasks.id, taskId),
				eq(tasks.creatorId, creatorId),
				inArray(tasks.status, ['open', 'claimed', 'submitted'])
			)
		)
		.returning({ id: tasks.id });
	if (res.length === 0) throw new TaskError("You can't archive that task.");
}

export interface TaskView {
	id: string;
	title: string;
	notes: string | null;
	price: number;
	recurring: boolean;
	rrule: string | null;
	recurrenceLabel: string | null;
	nextDueAt: Date | null;
	status: string;
	creatorId: string;
	creatorName: string;
	claimedById: string | null;
	claimerName: string | null;
	createdAt: Date;
	// Empty → open to all friends. Otherwise the friend ids (+ names) allowed to
	// claim. Names are for display; ids drive the edit picker's pre-selection.
	audienceIds: string[];
	audienceNames: string[];
}

/**
 * Everything the Tasks page needs for `userId`, in three buckets:
 *   posted    — tasks I created (open/claimed/submitted/done), newest first
 *   available — friends' open tasks I could claim
 *   doing     — tasks I've claimed (claimed/submitted)
 */
export async function listTasksForUser(userId: string): Promise<{
	posted: TaskView[];
	available: TaskView[];
	doing: TaskView[];
}> {
	// Task + creator name + claimer name (claimer resolved via a scalar subquery).
	const rows = await db
		.select({
			t: tasks,
			creatorName: users.displayName,
			claimerName: sql<
				string | null
			>`(select display_name from users u2 where u2.id = ${tasks.claimedBy})`
		})
		.from(tasks)
		.innerJoin(users, eq(users.id, tasks.creatorId))
		.where(ne(tasks.status, 'archived'))
		.orderBy(desc(tasks.createdAt));

	// Claim allowlists for every visible task (id + display name), grouped by task.
	const audRows = await db
		.select({
			taskId: taskAudience.taskId,
			userId: taskAudience.userId,
			name: users.displayName
		})
		.from(taskAudience)
		.innerJoin(users, eq(users.id, taskAudience.userId))
		.innerJoin(tasks, eq(tasks.id, taskAudience.taskId))
		.where(ne(tasks.status, 'archived'));
	const audienceByTask = new Map<string, { ids: string[]; names: string[] }>();
	for (const a of audRows) {
		const entry = audienceByTask.get(a.taskId) ?? { ids: [], names: [] };
		entry.ids.push(a.userId);
		entry.names.push(a.name);
		audienceByTask.set(a.taskId, entry);
	}

	const friends = new Set(await friendIds(userId));
	const posted: TaskView[] = [];
	const available: TaskView[] = [];
	const doing: TaskView[] = [];
	for (const r of rows) {
		const t = r.t;
		const aud = audienceByTask.get(t.id) ?? { ids: [], names: [] };
		const v: TaskView = {
			id: t.id,
			title: t.title,
			notes: t.notes,
			price: t.price,
			recurring: t.recurring,
			rrule: t.rrule,
			recurrenceLabel: t.rrule ? recurrenceLabel(t.rrule) : null,
			nextDueAt: t.nextDueAt,
			status: t.status,
			creatorId: t.creatorId,
			creatorName: r.creatorName,
			claimedById: t.claimedBy,
			claimerName: r.claimerName,
			createdAt: t.createdAt,
			audienceIds: aud.ids,
			audienceNames: aud.names
		};
		if (v.creatorId === userId) posted.push(v);
		else if (
			v.status === 'open' &&
			friends.has(v.creatorId) &&
			(v.audienceIds.length === 0 || v.audienceIds.includes(userId))
		) {
			available.push(v);
		}
		if (v.claimedById === userId && (v.status === 'claimed' || v.status === 'submitted')) {
			doing.push(v);
		}
	}
	return { posted, available, doing };
}
