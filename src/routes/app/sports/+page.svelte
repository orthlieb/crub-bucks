<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import BetCard, { type BetTone } from '$lib/components/BetCard.svelte';

	let { data }: { data: PageData } = $props();

	type Market = PageData['markets'][number];

	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	function kickoff(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		return d.toLocaleString(data.locale, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	// Per-sport fallback glyph for the card icon when no league logo is present
	// (in production the real league crest comes through as the logo).
	const SPORT_ICON: Record<string, string> = {
		soccer: '⚽',
		baseball: '⚾',
		basketball: '🏀',
		hockey: '🏒',
		football: '🏈',
		cfl: '🏈'
	};
	const sportIcon = (s: string) => SPORT_ICON[s] ?? '🏆';

	function sideName(m: Market, side: string | null): string {
		if (side === 'home') return m.homeAbbr || m.homeName;
		if (side === 'away') return m.awayAbbr || m.awayName;
		return 'Draw';
	}

	function cardLabel(m: Market): string {
		if (m.status === 'void') return 'Push';
		if (m.status === 'resolved') return m.winningSide === 'draw' ? 'Push' : 'Final';
		return m.phase === 'live' ? 'Live' : 'Open';
	}
	function cardTone(m: Market): BetTone {
		if (m.status === 'void') return 'amber';
		if (m.status === 'resolved') return 'blue';
		return m.phase === 'live' ? 'violet' : 'amber';
	}
	function cardComment(m: Market): string {
		if (m.status === 'void') return m.resolutionNote ?? 'Pushed — wagers refunded';
		if (m.status === 'resolved')
			return m.winningSide === 'draw'
				? 'Draw — wagers pushed (refunded)'
				: `${sideName(m, m.winningSide)} won`;
		if (m.phase === 'live') return 'In play — awaiting result';
		const total = m.pools.reduce((s, p) => s + p.total, 0);
		const sidesWithMoney = m.pools.filter((p) => p.total > 0).length;
		return sidesWithMoney < 2 ? `${total} ₡ — awaiting counter-bets` : `${total} ₡ in the pool`;
	}

	const groups = $derived.by(() => ({
		upcoming: data.markets.filter((m) => m.phase === 'upcoming'),
		live: data.markets.filter((m) => m.phase === 'live'),
		settled: data.markets.filter((m) => m.phase === 'settled')
	}));
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Sports</h1>
		<p class="mt-1 text-muted-foreground">
			Back an outcome with Crub Bucks — winners split the losers' pool.
		</p>
	</header>

	<div class="flex flex-wrap gap-2">
		<Button href="/app/sports/new">Bet on a game</Button>
	</div>

	{#snippet section(heading: string, markets: Market[])}
		{#if markets.length > 0}
			<section>
				<h2 class="text-xl font-semibold tracking-tight">{heading}</h2>
				<div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
					{#each markets as m (m.id)}
						<BetCard
							href={`/app/sports/${m.id}`}
							icon={sportIcon(m.sport)}
							iconImg={m.leagueLogo}
							label={cardLabel(m)}
							tone={cardTone(m)}
							title={`${m.homeName} vs ${m.awayName}`}
							comment={mounted ? `${cardComment(m)} · ${kickoff(m.startTime)}` : cardComment(m)}
							date={m.startTime}
							locale={data.locale}
						/>
					{/each}
				</div>
			</section>
		{/if}
	{/snippet}

	{#if data.markets.length === 0}
		<Card>
			<CardContent class="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
				No sports bets yet. Pick a game and place the first wager to open a market.
				<Button href="/app/sports/new" variant="outline" size="sm">Bet on a game</Button>
			</CardContent>
		</Card>
	{:else}
		{@render section('Awaiting Counter-Bets', groups.upcoming)}
		{@render section('Open Bets', groups.live)}
		{@render section('Recently Settled', groups.settled)}
	{/if}
</div>
