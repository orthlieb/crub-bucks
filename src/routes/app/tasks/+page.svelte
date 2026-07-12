<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { formatAmount } from '$lib/format';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const price = (coins: number) => `${formatAmount(coins, data.locale)} ₡`;
	let recurring = $state(false);
	let editingId = $state<string | null>(null);

	const STATUS_LABEL: Record<string, string> = {
		open: 'Open',
		claimed: 'Claimed',
		submitted: 'Awaiting approval',
		done: 'Done'
	};
</script>

<div class="space-y-8">
	<header class="flex flex-wrap items-end justify-between gap-3">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Tasks</h1>
			<p class="mt-1 text-muted-foreground">
				Post chores with a Crub Bucks reward. A friend claims one, does it, and you pay on approval.
			</p>
		</div>
		<div class="text-sm text-muted-foreground">
			Balance: <span class="font-semibold text-foreground tabular-nums">{price(data.balance)}</span>
		</div>
	</header>

	<!-- Create -->
	<Card>
		<CardHeader><CardTitle level={2}>Post a task</CardTitle></CardHeader>
		<CardContent>
			{#if form && 'createError' in form && form.createError}
				<Alert variant="destructive" class="mb-4"
					><AlertDescription>{form.createError}</AlertDescription></Alert
				>
			{:else if form && 'created' in form && form.created}
				<Alert variant="success" class="mb-4"
					><AlertDescription>Task posted.</AlertDescription></Alert
				>
			{/if}
			<form method="POST" action="?/create" use:enhance class="space-y-3">
				<div class="grid gap-3 sm:grid-cols-[1fr_auto]">
					<div class="space-y-1">
						<Label for="title">Task</Label>
						<Input
							id="title"
							name="title"
							required
							placeholder="Take out the trash"
							maxlength={80}
						/>
					</div>
					<div class="space-y-1">
						<Label for="price">Reward (₡)</Label>
						<Input id="price" name="price" type="number" min="1" step="1" required class="w-28" />
					</div>
				</div>
				<div class="space-y-1">
					<Label for="notes">Notes (optional)</Label>
					<Input id="notes" name="notes" placeholder="Bins go out Tuesday night" maxlength={160} />
				</div>
				<div class="flex flex-wrap items-center gap-4">
					<label class="flex cursor-pointer items-center gap-2 text-sm select-none">
						<input
							type="checkbox"
							name="recurring"
							class="h-4 w-4 rounded border-input"
							bind:checked={recurring}
						/>
						<span>Recurring (repeatable)</span>
					</label>
					{#if recurring}
						<label class="text-sm">
							<span class="mr-2 text-muted-foreground">Cadence</span>
							<select
								name="cadence"
								class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
							>
								<option value="">—</option>
								<option value="daily">Daily</option>
								<option value="weekly">Weekly</option>
								<option value="monthly">Monthly</option>
							</select>
						</label>
					{/if}
					<Button type="submit" size="sm" class="ml-auto">Post task</Button>
				</div>
			</form>
		</CardContent>
	</Card>

	{#if form && 'taskError' in form && form.taskError}
		<Alert variant="destructive"><AlertDescription>{form.taskError}</AlertDescription></Alert>
	{/if}

	<!-- Available to claim -->
	<section class="space-y-3">
		<h2 class="text-xl font-semibold tracking-tight">Available from friends</h2>
		{#if data.available.length === 0}
			<p class="text-sm text-muted-foreground">Nothing to claim right now.</p>
		{:else}
			<ul class="space-y-2">
				{#each data.available as t (t.id)}
					<li class="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
						<div class="min-w-0 flex-1">
							<div class="font-medium">
								{t.title}
								{#if t.recurring}<Badge variant="secondary" class="ml-1 align-middle"
										>{t.cadence ?? 'recurring'}</Badge
									>{/if}
							</div>
							{#if t.notes}<div class="text-xs text-muted-foreground">{t.notes}</div>{/if}
							<div class="text-xs text-muted-foreground">from {t.creatorName}</div>
						</div>
						<div class="font-semibold tabular-nums">{price(t.price)}</div>
						<form method="POST" action="?/claim" use:enhance>
							<input type="hidden" name="taskId" value={t.id} />
							<Button type="submit" size="sm">Claim</Button>
						</form>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- Doing (claimed by me) -->
	{#if data.doing.length > 0}
		<section class="space-y-3">
			<h2 class="text-xl font-semibold tracking-tight">You're doing</h2>
			<ul class="space-y-2">
				{#each data.doing as t (t.id)}
					<li class="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
						<div class="min-w-0 flex-1">
							<div class="font-medium">{t.title}</div>
							<div class="text-xs text-muted-foreground">
								from {t.creatorName} · {STATUS_LABEL[t.status] ?? t.status}
							</div>
						</div>
						<div class="font-semibold tabular-nums">{price(t.price)}</div>
						{#if t.status === 'claimed'}
							<form method="POST" action="?/submit" use:enhance>
								<input type="hidden" name="taskId" value={t.id} />
								<Button type="submit" size="sm">Mark done</Button>
							</form>
							<form method="POST" action="?/release" use:enhance>
								<input type="hidden" name="taskId" value={t.id} />
								<Button type="submit" size="sm" variant="ghost" class="text-muted-foreground"
									>Release</Button
								>
							</form>
						{:else}
							<span class="text-sm text-muted-foreground">Waiting for approval</span>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<!-- Posted by me -->
	<section class="space-y-3">
		<h2 class="text-xl font-semibold tracking-tight">Posted by you</h2>
		{#if data.posted.length === 0}
			<p class="text-sm text-muted-foreground">You haven't posted any tasks yet.</p>
		{:else}
			<ul class="space-y-2">
				{#each data.posted as t (t.id)}
					<li class="rounded-lg border bg-card p-3">
						<div class="flex flex-wrap items-center gap-3">
							<div class="min-w-0 flex-1">
								<div class="font-medium">
									{t.title}
									{#if t.recurring}<Badge variant="secondary" class="ml-1 align-middle"
											>{t.cadence ?? 'recurring'}</Badge
										>{/if}
								</div>
								<div class="text-xs text-muted-foreground">
									{STATUS_LABEL[t.status] ?? t.status}{#if t.claimerName}
										· {t.claimerName}{/if}
								</div>
							</div>
							<div class="font-semibold tabular-nums">{price(t.price)}</div>
							{#if t.status === 'submitted'}
								<form method="POST" action="?/approve" use:enhance>
									<input type="hidden" name="taskId" value={t.id} />
									<Button type="submit" size="sm">Approve &amp; pay</Button>
								</form>
								<form method="POST" action="?/reject" use:enhance>
									<input type="hidden" name="taskId" value={t.id} />
									<Button type="submit" size="sm" variant="ghost" class="text-destructive"
										>Reject</Button
									>
								</form>
							{:else if t.status === 'open' || t.status === 'claimed'}
								<form method="POST" action="?/archive" use:enhance>
									<input type="hidden" name="taskId" value={t.id} />
									<Button type="submit" size="sm" variant="ghost" class="text-muted-foreground"
										>Archive</Button
									>
								</form>
							{/if}
							{#if t.status !== 'done'}
								<Button
									type="button"
									size="sm"
									variant="ghost"
									class="text-muted-foreground"
									onclick={() => (editingId = editingId === t.id ? null : t.id)}
								>
									{editingId === t.id ? 'Cancel' : 'Edit'}
								</Button>
							{/if}
						</div>

						{#if editingId === t.id}
							<!-- Open → edit everything; otherwise only the notes. -->
							<form
								method="POST"
								action="?/edit"
								use:enhance={() =>
									async ({ update }) => {
										await update();
										editingId = null;
									}}
								class="mt-3 space-y-2 border-t pt-3"
							>
								<input type="hidden" name="taskId" value={t.id} />
								{#if t.status === 'open'}
									<input type="hidden" name="full" value="1" />
									<div class="grid gap-2 sm:grid-cols-[1fr_auto]">
										<Input name="title" value={t.title} required maxlength={80} />
										<Input
											name="price"
											type="number"
											min="1"
											step="1"
											value={t.price / 100}
											required
											class="w-28"
										/>
									</div>
									<Input name="notes" value={t.notes ?? ''} placeholder="Notes" maxlength={160} />
									<div class="flex flex-wrap items-center gap-4">
										<label class="flex cursor-pointer items-center gap-2 text-sm select-none">
											<input
												type="checkbox"
												name="recurring"
												class="h-4 w-4 rounded border-input"
												checked={t.recurring}
											/>
											<span>Recurring</span>
										</label>
										<label class="text-sm">
											<span class="mr-2 text-muted-foreground">Cadence</span>
											<select
												name="cadence"
												class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
											>
												<option value="" selected={!t.cadence}>—</option>
												<option value="daily" selected={t.cadence === 'daily'}>Daily</option>
												<option value="weekly" selected={t.cadence === 'weekly'}>Weekly</option>
												<option value="monthly" selected={t.cadence === 'monthly'}>Monthly</option>
											</select>
										</label>
										<Button type="submit" size="sm" class="ml-auto">Save</Button>
									</div>
								{:else}
									<div class="flex flex-wrap items-end gap-2">
										<div class="flex-1 space-y-1">
											<Label class="text-xs text-muted-foreground">Notes</Label>
											<Input name="notes" value={t.notes ?? ''} maxlength={160} />
										</div>
										<Button type="submit" size="sm">Save notes</Button>
									</div>
								{/if}
							</form>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>
