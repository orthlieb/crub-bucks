<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import BetCard, { type BetTone } from '$lib/components/BetCard.svelte';
	import { cn } from '$lib/utils';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FilterX from '@lucide/svelte/icons/filter-x';

	let { data }: { data: PageData } = $props();

	type Market = PageData['markets'][number];

	let mounted = $state(false);

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

	const SPORT_LABELS: Record<string, string> = { cfl: 'CFL' };
	const sportLabel = (s: string) => SPORT_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

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

	// --- filters (search + sport), persisted across sessions -----------------
	let selectedSport = $state('all');
	let query = $state('');
	let filtersOpen = $state(false);
	const pill = (active: boolean) =>
		cn(
			'rounded-full border px-3 py-1 text-xs transition-colors',
			active
				? 'border-primary bg-accent font-medium text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent'
		);
	const isFiltering = $derived(query.trim() !== '' || selectedSport !== 'all');
	function clearFilters() {
		query = '';
		selectedSport = 'all';
	}

	const FILTERS_KEY = 'cb:sportsFilters';
	onMount(() => {
		try {
			const raw = localStorage.getItem(FILTERS_KEY);
			if (raw) {
				const f = JSON.parse(raw);
				if (typeof f.query === 'string') query = f.query;
				if (f.sport === 'all' || data.sports.includes(f.sport)) selectedSport = f.sport;
				if (typeof f.open === 'boolean') filtersOpen = f.open;
			}
		} catch {
			// ignore unreadable / outdated saved state
		}
		mounted = true;
	});
	$effect(() => {
		const snapshot = JSON.stringify({ query, sport: selectedSport, open: filtersOpen });
		if (!mounted) return;
		try {
			localStorage.setItem(FILTERS_KEY, snapshot);
		} catch {
			// ignore (private mode / quota)
		}
	});

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.markets.filter((m) => {
			if (selectedSport !== 'all' && m.sport !== selectedSport) return false;
			if (q) {
				const hay = `${m.homeName} ${m.homeAbbr} ${m.awayName} ${m.awayAbbr}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	const groups = $derived.by(() => ({
		upcoming: shown.filter((m) => m.phase === 'upcoming'),
		live: shown.filter((m) => m.phase === 'live'),
		settled: shown.filter((m) => m.phase === 'settled')
	}));
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Sports</h1>
		<p class="mt-1 text-muted-foreground">
			Back an outcome with Crub Bucks — winners split the losers' pool. Balance:
			<span class="font-medium tabular-nums">{data.balance} ₡</span>
		</p>
	</header>

	<div class="flex flex-wrap gap-2">
		<Button href="/app/sports/new">Bet on a game</Button>
	</div>

	<!-- Filters: search + collapsible Sport chips -->
	<div class="space-y-3">
		<div class="flex items-center gap-2">
			<div class="relative flex-1">
				<Search
					class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="search"
					bind:value={query}
					placeholder="Search teams…"
					aria-label="Search teams"
					class="pl-9"
				/>
			</div>
			{#if data.sports.length > 1}
				<button
					type="button"
					onclick={() => (filtersOpen = !filtersOpen)}
					aria-expanded={filtersOpen}
					class="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
				>
					Filters
					<ChevronDown class={cn('size-4 transition-transform', filtersOpen && 'rotate-180')} />
				</button>
			{/if}
			{#if isFiltering}
				<button
					type="button"
					onclick={clearFilters}
					class="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
				>
					<FilterX class="size-4" />
					Clear
				</button>
			{/if}
		</div>

		{#if filtersOpen && data.sports.length > 1}
			<div class="rounded-md border bg-muted/20 p-3">
				<div class="flex flex-wrap items-center gap-2">
					<span class="w-12 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Sport
					</span>
					{#each ['all', ...data.sports] as s (s)}
						<button
							type="button"
							class={pill(selectedSport === s)}
							onclick={() => (selectedSport = s)}
						>
							{s === 'all' ? 'All' : sportLabel(s)}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>

	{#snippet section(heading: string, markets: Market[])}
		{#if markets.length > 0}
			<section>
				<h2 class="text-xl font-semibold tracking-tight">{heading}</h2>
				<div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
					{#each markets as m (m.id)}
						<BetCard
							href={`/app/sports/${m.id}`}
							icon="🏆"
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
	{:else if shown.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				No games match your filters.
			</CardContent>
		</Card>
	{:else}
		{@render section('Awaiting Counter-Bets', groups.upcoming)}
		{@render section('Open Bets', groups.live)}
		{@render section('Recently Settled', groups.settled)}
	{/if}
</div>
