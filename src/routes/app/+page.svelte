<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent } from '$lib/components/ui/card';
	import BetCard from '$lib/components/BetCard.svelte';

	let { data }: { data: PageData } = $props();

	function fmtDate(d: Date | string | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Your bets</h1>
		<p class="mt-1 italic text-muted-foreground">{data.tagline}</p>
	</header>

	<div class="flex flex-wrap gap-2">
		<Button href="/app/bet/new" disabled={data.friends.length === 0}>Create a bet</Button>
	</div>

	{#if data.friends.length === 0}
		<Card>
			<CardContent class="py-6 text-center text-muted-foreground">
				Add a friend before you can start a bet.
				<a href="/app/friends" class="font-medium text-primary hover:underline">Add friends →</a>
			</CardContent>
		</Card>
	{/if}

	<!-- Pending acceptance -->
	{#if data.pendingBets.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Awaiting acceptance</h2>
			<div class="mt-3 space-y-2">
				{#each data.pendingBets as b (b.id)}
					<BetCard
						href={`/app/bet/${b.id}`}
						icon={b.icon}
						label={b.needsMyResponse ? 'Reply' : 'Pending'}
						tone="amber"
						people={b.people}
						class={b.needsMyResponse ? 'border-primary/60' : ''}
					>
						<div class="truncate font-semibold">{b.title}</div>
						<div class="mt-1 text-xs text-muted-foreground">
							{fmtDate(b.createdAt)}
						</div>
					</BetCard>
				{/each}
			</div>
		</section>
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
					<BetCard
						href={`/app/bet/${b.id}`}
						icon={b.icon}
						label="Open"
						tone="violet"
						people={b.people}
					>
						<div class="truncate font-semibold">{b.title}</div>
						<div class="mt-1 text-xs text-muted-foreground">
							{fmtDate(b.createdAt)}
						</div>
					</BetCard>
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
					<BetCard
						href={`/app/bet/${b.id}`}
						icon={b.icon}
						label={b.status === 'resolved' ? 'Resolved' : 'Cancelled'}
						tone={b.status === 'resolved' ? 'blue' : 'red'}
						people={b.people}
					>
						<div class="truncate font-medium">{b.title}</div>
						<div class="mt-1 text-xs text-muted-foreground">
							{b.status === 'resolved' ? `resolved ${fmtDate(b.resolvedAt)}` : 'cancelled'}
						</div>
					</BetCard>
				{/each}
			</div>
		</section>
	{/if}
</div>
