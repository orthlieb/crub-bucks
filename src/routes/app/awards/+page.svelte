<script lang="ts">
	import type { PageData } from './$types';
	import BadgeTile from '$lib/components/BadgeTile.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { formatAmount } from '$lib/format';
	import { assetUrl } from '$lib/assets';
	import { tierBug } from '$lib/badges';
	import { cn } from '$lib/utils';

	let { data }: { data: PageData } = $props();

	// Gold/silver/bronze medallion image for the podium; a plain number below.
	const MEDAL_TIER = ['gold', 'silver', 'bronze'] as const;
</script>

<div class="space-y-8">
	<header class="flex items-center gap-3">
		<img
			src={assetUrl('/awards.png', data.assetVersion)}
			alt=""
			class="h-16 w-16 shrink-0 object-contain"
		/>
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Awards</h1>
			<p class="mt-1 text-muted-foreground">
				{data.earnedCount} of {data.totalCount} badges earned. Keep learning new tricks, you old dog!
			</p>
		</div>
	</header>

	<!-- Leaderboard -->
	{#if data.leaderboard.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Leaderboard</h2>
			<p class="mt-1 text-sm text-muted-foreground">Top 10 by Crub Bucks.</p>
			<Card class="mt-3">
				<CardContent class="p-0">
					<ul class="divide-y">
						{#each data.leaderboard as entry, i (entry.userId)}
							{@const me = entry.userId === data.meId}
							<li class={cn('flex items-center gap-3 px-4 py-3', me && 'bg-accent/60')}>
								<span class="flex w-7 shrink-0 justify-center">
									{#if i < 3}
										<img
											src={tierBug(MEDAL_TIER[i])}
											alt={`${MEDAL_TIER[i]} medal`}
											class="h-6 w-6 object-contain"
										/>
									{:else}
										<span class="text-sm tabular-nums text-muted-foreground">{i + 1}</span>
									{/if}
								</span>
								<Avatar
									id={entry.userId}
									name={entry.displayName}
									avatarUpdatedAt={entry.avatarUpdatedAt}
									avatarIcon={entry.avatarIcon}
									size={32}
								/>
								<span class="min-w-0 flex-1 truncate font-medium">
									{entry.displayName}
									{#if me}<span class="text-xs font-normal text-muted-foreground">(you)</span>{/if}
								</span>
								<span
									class={cn(
										'shrink-0 tabular-nums font-semibold',
										entry.balance < 0 && 'text-destructive'
									)}
								>
									{formatAmount(entry.balance)} ₡
								</span>
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		</section>
	{/if}

	<section>
		<h2 class="text-xl font-semibold tracking-tight">Badges</h2>
		<div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each data.badges as badge (badge.key)}
				<BadgeTile {badge} />
			{/each}
		</div>
	</section>
</div>
