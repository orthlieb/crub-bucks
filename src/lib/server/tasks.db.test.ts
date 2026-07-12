import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tasks, taskCompletions } from './db/schema';
import { resetDb, createUser } from '../../test/db';
import { establishFriendship, userBalance, assertZeroSum } from './ledger';
import {
	createTask,
	editTask,
	claimTask,
	releaseTask,
	submitTask,
	approveTask,
	rejectTask,
	archiveTask,
	listTasksForUser,
	TaskError
} from './tasks';

beforeEach(resetDb);

/** A creator + taskee who are friends (so the taskee can claim). */
async function pair() {
	const creator = await createUser({ displayName: 'Cora' });
	const taskee = await createUser({ displayName: 'Tim' });
	await establishFriendship(creator.id, taskee.id);
	return { creator, taskee };
}

describe('tasks', () => {
	it('claim → submit → approve pays creator→taskee and archives a one-time task', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Trash',
			price: 500,
			recurring: false
		});

		await claimTask(id, taskee.id);
		await submitTask(id, taskee.id);
		await approveTask(id, creator.id);

		expect(await userBalance(creator.id)).toBe(-500); // wallets may go negative
		expect(await userBalance(taskee.id)).toBe(500);
		expect(await assertZeroSum()).toBe(true);

		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.status).toBe('done');
		const comps = await db.select().from(taskCompletions).where(eq(taskCompletions.taskId, id));
		expect(comps).toHaveLength(1);
		expect(comps[0]).toMatchObject({ approved: true, price: 500, taskeeId: taskee.id });
	});

	it('a recurring task returns to open after approval and can be claimed again', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Dishes',
			price: 300,
			recurring: true,
			cadence: 'daily'
		});

		await claimTask(id, taskee.id);
		await submitTask(id, taskee.id);
		await approveTask(id, creator.id);

		let [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.status).toBe('open');
		expect(t.claimedBy).toBeNull();
		expect(await userBalance(taskee.id)).toBe(300);

		await claimTask(id, taskee.id); // available again
		[t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.status).toBe('claimed');
	});

	it('reject reopens the task and pays nothing', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Vacuum',
			price: 400,
			recurring: false
		});
		await claimTask(id, taskee.id);
		await submitTask(id, taskee.id);
		await rejectTask(id, creator.id);

		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.status).toBe('open');
		expect(t.claimedBy).toBeNull();
		expect(await userBalance(taskee.id)).toBe(0);
		expect(await userBalance(creator.id)).toBe(0);
	});

	it('only a friend can claim, and not your own task', async () => {
		const { creator, taskee } = await pair();
		const stranger = await createUser();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Mow',
			price: 200,
			recurring: false
		});
		await expect(claimTask(id, stranger.id)).rejects.toBeInstanceOf(TaskError);
		await expect(claimTask(id, creator.id)).rejects.toBeInstanceOf(TaskError);
		await claimTask(id, taskee.id); // a friend can
	});

	it('lists tasks in the right buckets (available / posted / doing)', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Trash',
			price: 500,
			recurring: false
		});

		let forTaskee = await listTasksForUser(taskee.id);
		expect(forTaskee.available.map((t) => t.id)).toContain(id);
		expect(forTaskee.doing).toHaveLength(0);
		const forCreator = await listTasksForUser(creator.id);
		expect(forCreator.posted.map((t) => t.id)).toContain(id);
		expect(forCreator.available).toHaveLength(0); // can't claim your own

		await claimTask(id, taskee.id);
		forTaskee = await listTasksForUser(taskee.id);
		expect(forTaskee.available).toHaveLength(0);
		expect(forTaskee.doing.map((t) => t.id)).toContain(id);
	});
});

describe('tasks — guards & edge cases', () => {
	it('rejects an empty title or a non-positive price', async () => {
		const a = await createUser();
		await expect(
			createTask({ creatorId: a.id, title: '   ', price: 500, recurring: false })
		).rejects.toBeInstanceOf(TaskError);
		await expect(
			createTask({ creatorId: a.id, title: 'X', price: 0, recurring: false })
		).rejects.toBeInstanceOf(TaskError);
	});

	it('clears the cadence on a one-time task', async () => {
		const a = await createUser();
		const id = await createTask({
			creatorId: a.id,
			title: 'One',
			price: 100,
			recurring: false,
			cadence: 'daily'
		});
		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.recurring).toBe(false);
		expect(t.cadence).toBeNull();
	});

	it('a second friend cannot claim an already-claimed task', async () => {
		const { creator, taskee } = await pair();
		const other = await createUser();
		await establishFriendship(creator.id, other.id);
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		await claimTask(id, taskee.id);
		await expect(claimTask(id, other.id)).rejects.toBeInstanceOf(TaskError);
	});

	it('only the claimer can submit, and only a claimed task', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		await expect(submitTask(id, taskee.id)).rejects.toBeInstanceOf(TaskError); // not claimed
		await claimTask(id, taskee.id);
		await expect(submitTask(id, creator.id)).rejects.toBeInstanceOf(TaskError); // not the claimer
		await submitTask(id, taskee.id);
	});

	it('only the creator approves, and only a submitted task', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		await claimTask(id, taskee.id);
		await expect(approveTask(id, creator.id)).rejects.toBeInstanceOf(TaskError); // not submitted
		await submitTask(id, taskee.id);
		await expect(approveTask(id, taskee.id)).rejects.toBeInstanceOf(TaskError); // not the creator
		await approveTask(id, creator.id);
		expect(await userBalance(taskee.id)).toBe(200);
	});

	it('the claimer can release back to open; a non-claimer cannot', async () => {
		const { creator, taskee } = await pair();
		const other = await createUser();
		await establishFriendship(creator.id, other.id);
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		await claimTask(id, taskee.id);
		await expect(releaseTask(id, other.id)).rejects.toBeInstanceOf(TaskError);
		await releaseTask(id, taskee.id);
		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.status).toBe('open');
		expect(t.claimedBy).toBeNull();
		await claimTask(id, other.id); // free to claim again
	});

	it('the creator can archive a task; others cannot, and it leaves the lists', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		await expect(archiveTask(id, taskee.id)).rejects.toBeInstanceOf(TaskError);
		await archiveTask(id, creator.id);
		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.status).toBe('archived');
		expect((await listTasksForUser(taskee.id)).available.map((x) => x.id)).not.toContain(id);
		expect((await listTasksForUser(creator.id)).posted.map((x) => x.id)).not.toContain(id);
	});

	it('a non-friend never sees an open task as available', async () => {
		const creator = await createUser();
		const stranger = await createUser();
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		const lists = await listTasksForUser(stranger.id);
		expect(lists.available.map((x) => x.id)).not.toContain(id);
	});

	it('a recurring task pays each cycle and records a completion per approval', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Dishes',
			price: 300,
			recurring: true
		});
		for (let i = 0; i < 2; i++) {
			await claimTask(id, taskee.id);
			await submitTask(id, taskee.id);
			await approveTask(id, creator.id);
		}
		expect(await userBalance(taskee.id)).toBe(600);
		expect(await userBalance(creator.id)).toBe(-600);
		const comps = await db.select().from(taskCompletions).where(eq(taskCompletions.taskId, id));
		expect(comps).toHaveLength(2);
		expect(comps.every((c) => c.approved && c.price === 300)).toBe(true);
	});

	it('a completed one-time task cannot be claimed again', async () => {
		const { creator, taskee } = await pair();
		const other = await createUser();
		await establishFriendship(creator.id, other.id);
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 200,
			recurring: false
		});
		await claimTask(id, taskee.id);
		await submitTask(id, taskee.id);
		await approveTask(id, creator.id);
		await expect(claimTask(id, other.id)).rejects.toBeInstanceOf(TaskError);
	});
});

describe('tasks — editing', () => {
	it('edits everything while the task is open', async () => {
		const a = await createUser();
		const id = await createTask({ creatorId: a.id, title: 'Old', price: 100, recurring: false });
		await editTask(id, a.id, {
			title: 'New',
			notes: 'careful',
			price: 250,
			recurring: true,
			cadence: 'weekly'
		});
		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t).toMatchObject({
			title: 'New',
			notes: 'careful',
			price: 250,
			recurring: true,
			cadence: 'weekly'
		});
	});

	it('locks title & price once claimed — only the notes change', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'Trash',
			price: 500,
			recurring: false
		});
		await claimTask(id, taskee.id);
		await editTask(id, creator.id, { title: 'Hacked', price: 999, notes: 'bins out back' });
		const [t] = await db.select().from(tasks).where(eq(tasks.id, id));
		expect(t.title).toBe('Trash'); // unchanged
		expect(t.price).toBe(500); // unchanged
		expect(t.notes).toBe('bins out back'); // changed
	});

	it('rejects edits from a non-creator, on archived tasks, or with an invalid price', async () => {
		const { creator, taskee } = await pair();
		const id = await createTask({
			creatorId: creator.id,
			title: 'T',
			price: 100,
			recurring: false
		});
		await expect(editTask(id, taskee.id, { notes: 'x' })).rejects.toBeInstanceOf(TaskError);
		await expect(editTask(id, creator.id, { price: 0 })).rejects.toBeInstanceOf(TaskError);
		await archiveTask(id, creator.id);
		await expect(editTask(id, creator.id, { notes: 'x' })).rejects.toBeInstanceOf(TaskError);
	});
});
