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
						{#each data.leaderboard as entry (entry.userId)}
							{@const me = entry.userId === data.meId}
							{@const tier = entry.rank <= 3 ? MEDAL_TIER[entry.rank - 1] : null}
							<li class={cn('flex items-center gap-3 px-4 py-3', me && 'bg-accent/60')}>
								<span class="flex w-7 shrink-0 justify-center">
									{#if tier}
										<img src={tierBug(tier)} alt={`${tier} medal`} class="h-6 w-6 object-contain" />
									{:else}
										<span class="text-sm tabular-nums text-muted-foreground">{entry.rank}</span>
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
					<!-- Your own standing, when you're not already shown in the top 10. -->
					{#if data.myRank && !data.leaderboard.some((e) => e.userId === data.meId)}
						<div class="flex items-center gap-3 border-t bg-accent/60 px-4 py-3">
							<span class="w-7 shrink-0 text-center text-sm tabular-nums text-muted-foreground">
								{data.myRank.rank}
							</span>
							<span class="min-w-0 flex-1 truncate font-medium">
								You
								<span class="text-xs font-normal text-muted-foreground">of {data.myRank.total}</span
								>
							</span>
							<span
								class={cn(
									'shrink-0 font-semibold tabular-nums',
									data.myRank.balance < 0 && 'text-destructive'
								)}
							>
								{formatAmount(data.myRank.balance)} ₡
							</span>
						</div>
					{/if}
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
