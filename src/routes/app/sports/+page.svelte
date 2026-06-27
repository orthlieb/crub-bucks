<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import BetCard, { type BetTone } from '$lib/components/BetCard.svelte';
	import { cn } from '$lib/utils';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FilterX from '@lucide/svelte/icons/filter-x';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type GameCard = PageData['cards'][number];
	type Market = NonNullable<GameCard['market']>;

	// Kickoff times render client-side only, in the visitor's timezone.
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

	// Home/away only — a drawn game pushes (refund), so 'draw' isn't a pick.
	function allowedSides(): ('home' | 'away')[] {
		return ['home', 'away'];
	}
	function sideLabel(c: GameCard, side: string): string {
		if (side === 'home') return c.home.abbr || c.home.name;
		if (side === 'away') return c.away.abbr || c.away.name;
		return 'Draw';
	}
	function sideLogo(c: GameCard, side: string): string | null {
		return side === 'home' ? c.home.logo : side === 'away' ? c.away.logo : null;
	}

	// --- card phase → section + BetCard chrome -------------------------------
	type Phase = 'upcoming' | 'live' | 'settled';
	function phase(c: GameCard): Phase {
		const ms = c.market?.status;
		if (ms === 'resolved' || ms === 'void' || c.feedStatus === 'final') return 'settled';
		if (ms === 'closed' || c.feedStatus === 'in_progress') return 'live';
		return 'upcoming';
	}
	function cardLabel(c: GameCard): string {
		const ph = phase(c);
		if (ph === 'settled') {
			if (c.market?.status === 'void') return 'Void';
			if (c.market?.winningSide === 'draw') return 'Push';
			return 'Final';
		}
		return ph === 'live' ? 'Live' : 'Open';
	}
	function cardTone(c: GameCard): BetTone {
		const ph = phase(c);
		if (ph === 'settled') return c.market?.status === 'void' ? 'red' : 'blue';
		return ph === 'live' ? 'violet' : 'amber';
	}
	function cardComment(c: GameCard): string {
		const m = c.market;
		if (!m) return 'No market yet';
		if (m.status === 'resolved')
			return m.winningSide === 'draw'
				? 'Draw — wagers pushed (refunded)'
				: `${sideLabel(c, m.winningSide ?? '')} won`;
		if (m.status === 'void') return 'Voided — wagers refunded';
		if (m.status === 'closed') return 'Wagering closed — awaiting result';
		return `Pool ${totalPool(m)} ₡`;
	}

	// --- pool / odds helpers -------------------------------------------------
	function poolFor(m: Market, side: string) {
		return m.pools.find((p) => p.side === side);
	}
	function totalPool(m: Market): number {
		return m.pools.reduce((s, p) => s + p.total, 0);
	}
	// Parimutuel odds as profit-to-stake (N:1); even pools read "1:1".
	function oddsFor(m: Market, side: string): string {
		const p = poolFor(m, side)?.total ?? 0;
		const t = totalPool(m);
		if (p <= 0 || t <= 0) return '—';
		return `${Math.round((t / p - 1) * 10) / 10}:1`;
	}

	// --- filters (search + sport; phase is now the section grouping) ---------
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

	// Persist filters across sessions (validated on restore).
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
		return data.cards.filter((c) => {
			if (selectedSport !== 'all' && c.sport !== selectedSport) return false;
			if (q) {
				const hay = `${c.home.name} ${c.home.abbr} ${c.away.name} ${c.away.abbr}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	// Group into the same shape as the Bets tab.
	const groups = $derived.by(() => ({
		upcoming: shown.filter((c) => phase(c) === 'upcoming'),
		live: shown.filter((c) => phase(c) === 'live'),
		settled: shown.filter((c) => phase(c) === 'settled')
	}));

	const errorFor = (marketId: string) =>
		form && 'marketId' in form && form.marketId === marketId && 'message' in form
			? (form.message as string)
			: null;
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Sports</h1>
		<p class="mt-1 text-muted-foreground">
			Back an outcome with Crub Bucks — winners split the losers' pool. Balance:
			<span class="font-medium tabular-nums">{data.balance} ₡</span>
		</p>
	</header>

	{#if data.provider === 'mock'}
		<Alert variant="warning">
			<AlertTitle>Sample data</AlertTitle>
			<AlertDescription>
				The feed is running in <code>mock</code> mode — these are invented sample fixtures, not real games.
			</AlertDescription>
		</Alert>
	{/if}

	<!-- Filters: search + collapsible Sport chips (Account-statement style) -->
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

	{#if shown.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				No games match your filters.
			</CardContent>
		</Card>
	{/if}

	<!-- The market panel, reused for every card as its BetCard footer. -->
	{#snippet marketPanel(c: GameCard)}
		{#if !c.market}
			{#if data.isAdmin && phase(c) === 'upcoming'}
				<form method="POST" action="?/openMarket" use:enhance>
					<input type="hidden" name="eventId" value={c.eventId} />
					<Button type="submit" variant="outline" size="sm">Open</Button>
				</form>
			{:else}
				<p class="text-xs text-muted-foreground">No market yet.</p>
			{/if}
		{:else}
			{@const m = c.market}
			<div class="space-y-3">
				<!-- Pools, with team crests -->
				<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
					{#each allowedSides() as side (side)}
						{@const p = poolFor(m, side)}
						<span class="inline-flex items-center gap-1.5">
							{#if sideLogo(c, side)}
								<img src={sideLogo(c, side)} alt="" class="h-4 w-4 object-contain" loading="lazy" />
							{/if}
							<span class="font-medium">{sideLabel(c, side)}</span>
							<span class="text-muted-foreground">
								{p?.total ?? 0} ₡ · {p?.count ?? 0} backer{(p?.count ?? 0) === 1 ? '' : 's'} · {oddsFor(
									m,
									side
								)}
							</span>
						</span>
					{/each}
				</div>

				{#if m.myWager}
					<p class="text-sm">
						Your wager: <span class="font-medium"
							>{m.myWager.stake} ₡ on {sideLabel(c, m.myWager.side)}</span
						>
						{#if m.myWager.settledDelta !== null}
							—
							<span
								class={m.myWager.settledDelta > 0
									? 'text-success'
									: m.myWager.settledDelta < 0
										? 'text-destructive'
										: 'text-muted-foreground'}
							>
								{m.myWager.settledDelta > 0 ? '+' : ''}{m.myWager.settledDelta} ₡
							</span>
						{/if}
					</p>
				{/if}

				{#if m.status === 'open'}
					<form
						method="POST"
						action="?/placeWager"
						use:enhance
						class="flex flex-wrap items-end gap-2"
					>
						<input type="hidden" name="marketId" value={m.id} />
						<label class="text-sm">
							<span class="block text-xs text-muted-foreground">Pick</span>
							<select
								name="side"
								class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
							>
								{#each allowedSides() as side (side)}
									<option value={side}>{sideLabel(c, side)}</option>
								{/each}
							</select>
						</label>
						<label class="text-sm">
							<span class="block text-xs text-muted-foreground">Stake (₡)</span>
							<Input
								type="number"
								name="stake"
								min="1"
								max={data.balance}
								step="1"
								required
								class="w-28"
							/>
						</label>
						<Button type="submit" size="sm">{m.myWager ? 'Update' : 'Bet'}</Button>
					</form>
				{/if}

				{#if errorFor(m.id)}
					<p class="text-sm text-destructive">{errorFor(m.id)}</p>
				{/if}
			</div>
		{/if}
	{/snippet}

	<!-- One BetCard per game, identical chrome to the Bets tab. -->
	{#snippet gameCard(c: GameCard)}
		<BetCard
			icon="🏆"
			iconImg={c.leagueLogo}
			label={cardLabel(c)}
			tone={cardTone(c)}
			title={`${c.home.name} vs ${c.away.name}`}
			comment={mounted ? `${cardComment(c)} · ${kickoff(c.startTime)}` : cardComment(c)}
			date={c.startTime}
			locale={data.locale}
		>
			{@render marketPanel(c)}
		</BetCard>
	{/snippet}

	{#if groups.upcoming.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Awaiting Counter-Bets</h2>
			<div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
				{#each groups.upcoming as c (c.key)}
					{@render gameCard(c)}
				{/each}
			</div>
		</section>
	{/if}

	{#if groups.live.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Open Bets</h2>
			<div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
				{#each groups.live as c (c.key)}
					{@render gameCard(c)}
				{/each}
			</div>
		</section>
	{/if}

	{#if groups.settled.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Recently Settled</h2>
			<div class="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
				{#each groups.settled as c (c.key)}
					{@render gameCard(c)}
				{/each}
			</div>
		</section>
	{/if}
</div>
