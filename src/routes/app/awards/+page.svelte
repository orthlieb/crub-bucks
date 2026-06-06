<script lang="ts">
	import type { PageData } from './$types';
	import BadgeTile from '$lib/components/BadgeTile.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="space-y-8">
	<header class="flex items-stretch gap-3">
		<div class="shrink-0 self-stretch">
			<img src="/awards.png" alt="" class="h-full w-auto object-contain" />
		</div>
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Awards</h1>
			<p class="mt-1 text-muted-foreground">
				{data.earnedCount} of {data.totalCount} badges earned. Keep betting to climb the tiers.
			</p>
		</div>
	</header>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each data.badges as badge (badge.key)}
			<BadgeTile {badge} />
		{/each}
	</div>
</div>
