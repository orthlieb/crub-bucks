<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { formatSigned } from '$lib/format';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const fmtAmount = (n: number) => formatSigned(n, data.locale);
	function balanceClass(n: number): string {
		if (n > 0) return 'text-success';
		if (n < 0) return 'text-destructive';
		return 'text-muted-foreground';
	}
</script>

<div class="space-y-8">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<a href="/app" class="text-sm text-muted-foreground hover:text-foreground">← Dashboard</a>
			<h1 class="mt-1 text-3xl font-bold tracking-tight">Friends</h1>
			<p class="mt-1 text-muted-foreground">Send a request by email; they approve before you're connected.</p>
		</div>
		<div class="text-right">
			<div class="text-xs uppercase tracking-wide text-muted-foreground">Your balance</div>
			<div class="text-2xl font-bold tabular-nums {balanceClass(data.balance)}">
				{fmtAmount(data.balance)}&nbsp;<span class="text-sm text-muted-foreground">CB</span>
			</div>
		</div>
	</header>

	<!-- Add / request -->
	<Card>
		<CardHeader>
			<CardTitle level={2}>Add a friend</CardTitle>
			<CardDescription>They need a Crub Bucks account, and must approve your request.</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.requestError}
				<Alert variant="destructive" class="mb-4"><AlertDescription>{form.requestError}</AlertDescription></Alert>
			{:else if form?.requestMessage}
				<Alert variant="success" class="mb-4"><AlertDescription>{form.requestMessage}</AlertDescription></Alert>
			{/if}
			<form method="POST" action="?/request" use:enhance class="flex flex-col gap-3 sm:flex-row sm:items-end">
				<div class="flex-1 space-y-2">
					<Label for="email">Friend's email</Label>
					<Input id="email" name="email" type="email" placeholder="friend@example.com" required value={form?.email ?? ''} />
				</div>
				<Button type="submit">Send request</Button>
			</form>
		</CardContent>
	</Card>

	<!-- Incoming requests -->
	{#if data.incoming.length > 0}
		<section>
			<h2 class="flex items-center gap-3 text-xl font-semibold tracking-tight">
				<img
					src="/cala-watching.png"
					alt=""
					aria-hidden="true"
					width="240"
					height="400"
					class="h-10 w-auto select-none"
				/>
				Friend requests
				<Badge>{data.incoming.length}</Badge>
			</h2>
			<div class="mt-3 space-y-2">
				{#each data.incoming as r (r.requestId)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{r.displayName}</div>
								<div class="text-xs text-muted-foreground">{r.email} · wants to be friends</div>
							</div>
							<div class="flex gap-2">
								<form method="POST" action="?/accept" use:enhance>
									<input type="hidden" name="requestId" value={r.requestId} />
									<Button type="submit">Approve</Button>
								</form>
								<form method="POST" action="?/deny" use:enhance>
									<input type="hidden" name="requestId" value={r.requestId} />
									<Button type="submit" variant="outline">Deny</Button>
								</form>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Outgoing pending -->
	{#if data.outgoing.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Pending (sent)</h2>
			<div class="mt-3 space-y-2">
				{#each data.outgoing as r (r.requestId)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{r.displayName}</div>
								<div class="text-xs text-muted-foreground">{r.email} · awaiting their approval</div>
							</div>
							<form method="POST" action="?/cancel" use:enhance>
								<input type="hidden" name="requestId" value={r.requestId} />
								<Button type="submit" variant="ghost">Cancel</Button>
							</form>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Invited (not yet on Crub Bucks) -->
	{#if data.invites.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Invited (not yet joined)</h2>
			<div class="mt-3 space-y-2">
				{#each data.invites as inv (inv.id)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{inv.email}</div>
								<div class="text-xs text-muted-foreground">
									Invite emailed · you'll connect when they sign up
								</div>
							</div>
							<form method="POST" action="?/cancelInvite" use:enhance>
								<input type="hidden" name="inviteId" value={inv.id} />
								<Button type="submit" variant="ghost">Cancel</Button>
							</form>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Friends list + pay -->
	<section>
		<h2 class="text-xl font-semibold tracking-tight">Your friends ({data.friends.length})</h2>

		{#if form?.payError}
			<Alert variant="destructive" class="mt-3"><AlertDescription>{form.payError}</AlertDescription></Alert>
		{:else if form?.paid}
			<Alert variant="success" class="mt-3"><AlertDescription>Payment sent.</AlertDescription></Alert>
		{/if}

		{#if data.friends.length === 0}
			<Card class="mt-3">
				<CardContent class="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
					<img
						src="/cala-empty-friends.png"
						alt="Cala the dog sitting alone, waiting for someone to play."
						width="600"
						height="600"
						class="h-40 w-auto select-none opacity-90"
					/>
					No friends yet. Send a request above to get started.
				</CardContent>
			</Card>
		{:else}
			<div class="mt-3 space-y-2">
				{#each data.friends as f (f.id)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{f.displayName}</div>
								<div class="text-xs text-muted-foreground">{f.email}</div>
							</div>
							<div class="flex items-end gap-2">
								<form method="POST" action="?/pay" use:enhance class="flex items-end gap-2">
									<input type="hidden" name="toUserId" value={f.id} />
									<div class="space-y-1">
										<Label class="text-xs">Pay (CB)</Label>
										<Input type="number" name="amount" min="1" required class="w-20" placeholder="0" />
									</div>
									<div class="space-y-1">
										<Label class="text-xs">Note (optional)</Label>
										<Input name="memo" class="w-40" placeholder="What's it for?" maxlength={140} />
									</div>
									<Button type="submit">Pay</Button>
								</form>
								<form method="POST" action="?/unfriend" use:enhance>
									<input type="hidden" name="friendId" value={f.id} />
									<Button type="submit" variant="outline">Unfriend</Button>
								</form>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		{/if}
	</section>
</div>
