<script lang="ts">
	import type { PageData } from './$types';
	import BadgeTile from '$lib/components/BadgeTile.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="space-y-8">
	<header class="flex items-center gap-3">
		<img src="/awards.png" alt="" class="h-16 w-16 shrink-0 object-contain" />
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Awards</h1>
			<p class="mt-1 text-muted-foreground">
				{data.earnedCount} of {data.totalCount} badges earned. Keep learning new tricks, you old dog!
			</p>
		</div>
	</header>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
		{#each data.badges as badge (badge.key)}
			<BadgeTile {badge} />
		{/each}
	</div>
</div>
