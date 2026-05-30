<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { formatSigned } from '$lib/format';

	let { data }: { data: PageData } = $props();

	const fmtAmount = (n: number) => formatSigned(n, data.locale);
	function balanceClass(n: number): string {
		if (n > 0) return 'text-success';
		if (n < 0) return 'text-destructive';
		return 'text-muted-foreground';
	}
	function fmtDate(d: Date | string | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<div class="space-y-8">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Your dashboard</h1>
			<p class="mt-1 italic text-muted-foreground">{data.tagline}</p>
		</div>
		<div class="text-right">
			<div class="text-xs uppercase tracking-wide text-muted-foreground">Balance</div>
			<div class="text-3xl font-bold tabular-nums {balanceClass(data.balance)}">
				{fmtAmount(data.balance)}&nbsp;<span class="text-base text-muted-foreground">CB</span>
			</div>
		</div>
	</header>

	<div class="flex flex-wrap gap-2">
		<Button href="/app/bet/new" disabled={data.friends.length === 0}>Create a bet</Button>
		<Button href="/app/friends" variant="outline">Friends ({data.friends.length})</Button>
	</div>

	{#if data.friends.length === 0}
		<Card>
			<CardContent class="py-6 text-center text-muted-foreground">
				Add a friend before you can start a bet.
				<a href="/app/friends" class="font-medium text-primary hover:underline">Add friends →</a>
			</CardContent>
		</Card>
	{/if}

	<!-- Open bets -->
	<section>
		<h2 class="text-xl font-semibold tracking-tight">Open bets</h2>
		{#if data.openBets.length === 0}
			<Card class="mt-3">
				<CardContent class="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
					<img
						src="/cala-napping.png"
						alt="Cala the dog curled up napping — no open bets to keep her awake."
						width="260"
						height="260"
						class="h-28 w-auto select-none opacity-90"
					/>
					No open bets. Settle a friendly argument — create one.
				</CardContent>
			</Card>
		{:else}
			<div class="mt-3 space-y-2">
				{#each data.openBets as b (b.id)}
					<a
						href={`/app/bet/${b.id}`}
						class="flex items-center justify-between rounded-lg border bg-card p-4 shadow-sm transition-colors hover:bg-accent"
					>
						<div>
							<div class="font-semibold">{b.title}</div>
							<div class="mt-1 text-xs text-muted-foreground">
								{b.participantCount} participant{b.participantCount === 1 ? '' : 's'} ·
								{fmtDate(b.createdAt)}
							</div>
						</div>
						<Badge class="w-24 justify-center uppercase">open</Badge>
					</a>
				{/each}
			</div>
		{/if}
	</section>

	<!-- Settled bets -->
	{#if data.settledBets.length > 0}
		<section>
			<div class="flex items-end justify-between">
				<h2 class="text-xl font-semibold tracking-tight">Recently settled</h2>
				{#if data.hasMoreSettled}
					<a href="/app/feed?mine=1" class="text-sm text-primary hover:underline">See all →</a>
				{/if}
			</div>
			<div class="mt-3 space-y-2">
				{#each data.settledBets as b (b.id)}
					<a
						href={`/app/bet/${b.id}`}
						class="flex items-center justify-between rounded-lg border bg-card p-4 text-muted-foreground shadow-sm transition-colors hover:bg-accent"
					>
						<div>
							<div class="font-medium text-foreground">{b.title}</div>
							<div class="mt-1 text-xs">
								{b.participantCount} participant{b.participantCount === 1 ? '' : 's'} ·
								{b.status === 'resolved' ? `resolved ${fmtDate(b.resolvedAt)}` : 'cancelled'}
							</div>
						</div>
						<Badge variant={b.status === 'resolved' ? 'info' : 'destructive'} class="w-24 justify-center uppercase">{b.status}</Badge>
					</a>
				{/each}
			</div>
		</section>
	{/if}
</div>
