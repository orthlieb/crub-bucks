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
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let level = $state<'info' | 'success' | 'warning'>('info');
	let target = $state<'broadcast' | 'user'>('broadcast');
	let userId = $state('');

	function fmtDate(d: Date | string): string {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Notifications</h1>
		<p class="mt-1 text-muted-foreground">
			Send a message to everyone or to one user. Recipients see it at the top of every app
			page and can dismiss it for themselves. Deleting here retracts it for everyone.
		</p>
	</header>

	<!-- Send form -->
	<Card>
		<CardHeader>
			<CardTitle level={2}>Send a notification</CardTitle>
			<CardDescription>
				Keep it short — title shows boldly, body is a sentence or two underneath.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.error}
				<Alert variant="destructive" class="mb-4">
					<AlertDescription>{form.error}</AlertDescription>
				</Alert>
			{/if}
			{#if form?.ok === 'sent'}
				<Alert variant="success" class="mb-4">
					<AlertDescription>Notification sent.</AlertDescription>
				</Alert>
			{/if}

			<form method="POST" action="?/send" use:enhance class="space-y-4">
				<div class="space-y-2">
					<Label>Audience</Label>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							onclick={() => (target = 'broadcast')}
							class="rounded-md border px-3 py-2 text-sm transition-colors {target === 'broadcast'
								? 'border-primary bg-accent'
								: 'hover:bg-accent'}"
						>
							Everyone
						</button>
						<button
							type="button"
							onclick={() => (target = 'user')}
							class="rounded-md border px-3 py-2 text-sm transition-colors {target === 'user'
								? 'border-primary bg-accent'
								: 'hover:bg-accent'}"
						>
							One user
						</button>
					</div>
					<input type="hidden" name="target" value={target} />
				</div>

				{#if target === 'user'}
					<div class="space-y-2">
						<Label for="recipient">Recipient</Label>
						<select
							id="recipient"
							name="userId"
							bind:value={userId}
							required
							class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							<option value="">— Pick a user —</option>
							{#each data.recipients as r (r.id)}
								<option value={r.id}>{r.displayName} ({r.email})</option>
							{/each}
						</select>
					</div>
				{/if}

				<div class="space-y-2">
					<Label>Level</Label>
					<div class="flex flex-wrap gap-2">
						{#each ['info', 'success', 'warning'] as l (l)}
							<button
								type="button"
								onclick={() => (level = l as 'info' | 'success' | 'warning')}
								class="rounded-md border px-3 py-2 text-sm capitalize transition-colors {level === l
									? 'border-primary bg-accent'
									: 'hover:bg-accent'}"
							>
								{l}
							</button>
						{/each}
					</div>
					<input type="hidden" name="level" value={level} />
				</div>

				<div class="space-y-2">
					<Label for="title">Title</Label>
					<Input id="title" name="title" required placeholder="Heads up: scheduled downtime tonight at 9 PM." />
				</div>
				<div class="space-y-2">
					<Label for="body">Body (optional)</Label>
					<Input id="body" name="body" placeholder="Should take about 15 minutes. Thanks for your patience." />
				</div>

				<Button type="submit">Send</Button>
			</form>
		</CardContent>
	</Card>

	<!-- Active notifications -->
	<Card>
		<CardHeader>
			<CardTitle level={2}>Active notifications</CardTitle>
			<CardDescription>
				Newest first. Delete to retract a notification for everyone (the user-side dismiss
				button only hides it for that one user).
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.ok === 'deleted'}
				<Alert variant="success" class="mb-4">
					<AlertDescription>Notification deleted.</AlertDescription>
				</Alert>
			{/if}

			{#if data.items.length === 0}
				<p class="text-sm text-muted-foreground">Nothing sent yet.</p>
			{:else}
				<div class="divide-y">
					{#each data.items as n (n.id)}
						<div class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
							<div class="min-w-0 space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<Badge
										variant={n.level === 'success'
											? 'success'
											: n.level === 'warning'
												? 'gold'
												: 'secondary'}
										class="uppercase">{n.level}</Badge
									>
									{#if n.isBroadcast}
										<Badge variant="info" class="uppercase">Everyone</Badge>
									{:else}
										<Badge variant="outline">→ {n.recipientName ?? 'Unknown'}</Badge>
									{/if}
									<span class="text-xs text-muted-foreground">{fmtDate(n.createdAt)}</span>
									{#if n.createdByName}
										<span class="text-xs text-muted-foreground">· by {n.createdByName}</span>
									{:else}
										<span class="text-xs text-muted-foreground">· system</span>
									{/if}
									{#if n.isBroadcast && n.dismissCount > 0}
										<span class="text-xs text-muted-foreground">· dismissed by {n.dismissCount}</span>
									{/if}
								</div>
								<div class="font-medium">{n.title}</div>
								{#if n.body}
									<div class="text-sm text-muted-foreground">{n.body}</div>
								{/if}
							</div>
							<form method="POST" action="?/delete" use:enhance class="shrink-0">
								<input type="hidden" name="id" value={n.id} />
								<Button type="submit" variant="outline" size="sm">Delete</Button>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
