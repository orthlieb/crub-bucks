<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import FeedItemRow, { feedHaystack } from '$lib/components/FeedItemRow.svelte';
	import { formatAmount } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const fmt = (n: number) => formatAmount(n, data.locale);

	// Client-side typeahead over the loaded items (titles, parties, comments).
	let q = $state('');
	const rows = $derived(data.items.map((item) => ({ item, hay: feedHaystack(item) })));
	const filtered = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		if (!needle) return data.items;
		return rows.filter((r) => r.hay.includes(needle)).map((r) => r.item);
	});
</script>

<div class="space-y-6">
	<header class="flex items-center gap-3">
		<img src="/feed.png" alt="" class="h-16 w-16 shrink-0 object-contain" />
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Feed</h1>
			<p class="mt-1 text-muted-foreground">In circulation {fmt(-data.bank)} ₡</p>
		</div>
	</header>

	{#if data.items.length > 0}
		<Input
			type="search"
			bind:value={q}
			placeholder="Search bets, people, comments…"
			autocomplete="off"
			aria-label="Search the feed"
			class="w-full sm:max-w-xs"
		/>
	{/if}

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
				No activity from you or your friends yet. Make a bet or pay a friend to kick things off.
			</CardContent>
		</Card>
	{:else if filtered.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-sm text-muted-foreground">
				No results for “{q.trim()}”.
			</CardContent>
		</Card>
	{:else}
		<div class="grid grid-cols-1 gap-2 lg:grid-cols-2">
			{#each filtered as item (item.id)}
				<FeedItemRow {item} locale={data.locale} />
			{/each}
		</div>
	{/if}
</div>
