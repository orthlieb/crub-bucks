<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import FeedItemRow from '$lib/components/FeedItemRow.svelte';
	import { formatAmount } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const fmt = (n: number) => formatAmount(n, data.locale);
</script>

<div class="space-y-6">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Feed</h1>
		<p class="mt-1 text-muted-foreground">
			{#if data.mine}
				Just the bets and payments you’re in.
			{:else}
				In circulation {fmt(-data.bank)} ₡
			{/if}
		</p>
	</header>

	<div class="inline-flex rounded-md border p-0.5 text-sm">
		<a
			href="/app/feed"
			class="rounded-sm px-3 py-1.5 transition-colors {data.mine
				? 'text-muted-foreground hover:bg-accent'
				: 'bg-accent font-medium text-foreground'}"
			aria-current={data.mine ? undefined : 'page'}
		>
			Friends
		</a>
		<a
			href="/app/feed?mine=1"
			class="rounded-sm px-3 py-1.5 transition-colors {data.mine
				? 'bg-accent font-medium text-foreground'
				: 'text-muted-foreground hover:bg-accent'}"
			aria-current={data.mine ? 'page' : undefined}
		>
			Just me
		</a>
	</div>

	{#if data.items.length === 0}
		<Card>
			<CardContent class="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
				<img
					src="/cala-empty-feed.png"
					alt="Cala the dog flopped down with her chin on her paws — nothing's happening."
					width="260"
					height="260"
					class="h-32 w-auto select-none opacity-90"
				/>
				{#if data.mine}
					You're not in anything yet. Start a bet or pay a friend.
				{:else}
					No activity from you or your friends yet. Make a bet or pay a friend to kick things off.
				{/if}
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-2">
			{#each data.items as item (item.id)}
				<FeedItemRow {item} locale={data.locale} />
			{/each}
		</div>
	{/if}
</div>
