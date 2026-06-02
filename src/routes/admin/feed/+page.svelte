<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import FeedItemRow, { feedHaystack } from '$lib/components/FeedItemRow.svelte';

	let { data }: { data: PageData } = $props();

	let q = $state('');

	// Precompute the search text for each item once; filter as the admin types.
	const rows = $derived(data.items.map((item) => ({ item, hay: feedHaystack(item) })));
	const filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return data.items;
		return rows.filter((r) => r.hay.includes(needle)).map((r) => r.item);
	});
</script>

<div class="space-y-6">
	<header>
		<h1 class="text-2xl font-bold tracking-tight">Global feed</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			Every user's bets and payments. Search across titles, parties, comments, and resolution
			notes.
		</p>
	</header>

	<div class="space-y-1">
		<Input
			type="search"
			bind:value={q}
			placeholder="Search bets, people, comments…"
			autocomplete="off"
			aria-label="Search the global feed"
		/>
		<p class="text-xs text-muted-foreground">
			{#if q.trim()}
				{filtered.length} of {data.items.length} matching
			{:else}
				Showing the {data.items.length} most recent events
			{/if}
		</p>
	</div>

	{#if filtered.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-sm text-muted-foreground">
				{#if q.trim()}
					No events match “{q.trim()}”.
				{:else}
					Nothing's happened yet.
				{/if}
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-2">
			{#each filtered as item (item.id)}
				<!-- Bet links go to the participant-only bet page, so don't link them
				     from the admin view (an admin who isn't a participant gets a 404). -->
				<FeedItemRow {item} locale={data.locale} linkBets={false} />
			{/each}
		</div>
	{/if}
</div>
