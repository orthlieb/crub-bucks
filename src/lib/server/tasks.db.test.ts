import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from './db';
import { tasks, taskCompletions } from './db/schema';
import { resetDb, createUser } from '../../test/db';
import { establishFriendship, userBalance, assertZeroSum } from './ledger';
import {
	createTask,
	claimTask,
	submitTask,
	approveTask,
	rejectTask,
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
