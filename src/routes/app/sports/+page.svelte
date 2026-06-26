<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FilterX from '@lucide/svelte/icons/filter-x';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type GameCard = PageData['cards'][number];
	type Market = NonNullable<GameCard['market']>;

	// Kickoff times render client-side only, in the visitor's timezone (avoids an
	// SSR/UTC hydration mismatch). `mounted` flips in onMount below.
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

	// --- card phase (drives the status pill + filter) ------------------------
	type Phase = 'upcoming' | 'live' | 'settled';
	function phase(c: GameCard): Phase {
		const ms = c.market?.status;
		if (ms === 'resolved' || ms === 'void' || c.feedStatus === 'final') return 'settled';
		if (ms === 'closed' || c.feedStatus === 'in_progress') return 'live';
		return 'upcoming';
	}
	const PHASE_LABEL: Record<Phase, string> = {
		upcoming: 'Upcoming',
		live: 'Live',
		settled: 'Settled'
	};
	const PHASE_CLASS: Record<Phase, string> = {
		upcoming: 'bg-muted text-muted-foreground',
		live: 'bg-primary text-primary-foreground',
		settled: 'bg-accent text-accent-foreground'
	};

	// --- pool / odds helpers -------------------------------------------------
	function poolFor(m: Market, side: string) {
		return m.pools.find((p) => p.side === side);
	}
	function totalPool(m: Market): number {
		return m.pools.reduce((s, p) => s + p.total, 0);
	}
	// Current parimutuel odds for a side as profit-to-stake (N:1): you'd win ≈ N
	// CB of profit per 1 staked if this side wins. N = total/side − 1, so even
	// pools read "1:1". Shifts as more money comes in.
	function oddsFor(m: Market, side: string): string {
		const p = poolFor(m, side)?.total ?? 0;
		const t = totalPool(m);
		if (p <= 0 || t <= 0) return '—';
		const profit = Math.round((t / p - 1) * 10) / 10; // 1 decimal, trimmed
		return `${profit}:1`;
	}

	// --- filters -------------------------------------------------------------
	let selectedSport = $state('all');
	let selectedPhase = $state<'all' | Phase>('all');
	let query = $state('');
	const PHASES: { key: 'all' | Phase; label: string }[] = [
		{ key: 'all', label: 'All' },
		{ key: 'upcoming', label: 'Upcoming' },
		{ key: 'live', label: 'Live' },
		{ key: 'settled', label: 'Settled' }
	];

	// Filter UI modelled on the Account statement: search + collapsible panel of
	// rounded pill chips + a clear control.
	let filtersOpen = $state(false);
	const pill = (active: boolean) =>
		cn(
			'rounded-full border px-3 py-1 text-xs transition-colors',
			active
				? 'border-primary bg-accent font-medium text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent'
		);
	const isFiltering = $derived(
		query.trim() !== '' || selectedSport !== 'all' || selectedPhase !== 'all'
	);
	function clearFilters() {
		query = '';
		selectedSport = 'all';
		selectedPhase = 'all';
	}

	// Persist the filter state across sessions (localStorage). Restored on mount;
	// re-saved whenever it changes. Validated on restore so a stale sport that's
	// no longer in the feed doesn't hide every game.
	const FILTERS_KEY = 'cb:sportsFilters';
	onMount(() => {
		try {
			const raw = localStorage.getItem(FILTERS_KEY);
			if (raw) {
				const f = JSON.parse(raw);
				if (typeof f.query === 'string') query = f.query;
				if (f.sport === 'all' || data.sports.includes(f.sport)) selectedSport = f.sport;
				if (PHASES.some((p) => p.key === f.phase)) selectedPhase = f.phase;
				if (typeof f.open === 'boolean') filtersOpen = f.open;
			}
		} catch {
			// ignore unreadable / outdated saved state
		}
		mounted = true;
	});
	$effect(() => {
		// Read deps first so the effect tracks them, then gate on mounted so we
		// never clobber saved state with defaults before the restore runs.
		const snapshot = JSON.stringify({
			query,
			sport: selectedSport,
			phase: selectedPhase,
			open: filtersOpen
		});
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
			if (selectedPhase !== 'all' && phase(c) !== selectedPhase) return false;
			if (q) {
				const hay = `${c.home.name} ${c.home.abbr} ${c.away.name} ${c.away.abbr}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	const errorFor = (marketId: string) =>
		form && 'marketId' in form && form.marketId === marketId && 'message' in form
			? (form.message as string)
			: null;
</script>

<div class="space-y-6">
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
			<button
				type="button"
				onclick={() => (filtersOpen = !filtersOpen)}
				aria-expanded={filtersOpen}
				class="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
			>
				Filters
				<ChevronDown class={cn('size-4 transition-transform', filtersOpen && 'rotate-180')} />
			</button>
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

		{#if filtersOpen}
			<div class="space-y-3 rounded-md border bg-muted/20 p-3">
				{#if data.sports.length > 1}
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
				{/if}
				<div class="flex flex-wrap items-center gap-2">
					<span class="w-12 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
						Phase
					</span>
					{#each PHASES as f (f.key)}
						<button
							type="button"
							class={pill(selectedPhase === f.key)}
							onclick={() => (selectedPhase = f.key)}
						>
							{f.label}
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
	{:else}
		<ul class="space-y-3">
			{#each shown as c (c.key)}
				{@const ph = phase(c)}
				<li>
					<Card>
						<CardContent class="space-y-3 py-4">
							<!-- Header: status, kickoff, league -->
							<div class="flex items-center justify-between gap-3">
								<div class="flex items-center gap-2">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {PHASE_CLASS[
											ph
										]}"
									>
										{PHASE_LABEL[ph]}
									</span>
									<span class="text-xs text-muted-foreground"
										>{mounted ? kickoff(c.startTime) : ''}</span
									>
								</div>
								<p class="flex items-center gap-1 text-xs text-muted-foreground">
									{#if c.leagueLogo}
										<img src={c.leagueLogo} alt="" class="h-4 w-4 object-contain" loading="lazy" />
									{/if}
									{c.league}
								</p>
							</div>

							<!-- Teams + score. The team block can shrink (min-w-0) and wrap
							     (flex-wrap) so long names never push the score off the card;
							     the score keeps its own non-shrinking, no-wrap column. -->
							<div class="flex items-start justify-between gap-3">
								<div
									class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold"
								>
									<span
										class="inline-flex min-w-0 items-center gap-1.5"
										class:opacity-50={c.winner === 'away'}
									>
										{#if c.home.logo}
											<img
												src={c.home.logo}
												alt=""
												class="h-5 w-5 shrink-0 object-contain"
												loading="lazy"
											/>
										{/if}
										<span class="min-w-0 break-words">{c.home.name}</span>
										<span class="text-sm font-normal text-muted-foreground">({c.home.abbr})</span>
									</span>
									<span class="text-sm text-muted-foreground">vs</span>
									<span
										class="inline-flex min-w-0 items-center gap-1.5"
										class:opacity-50={c.winner === 'home'}
									>
										{#if c.away.logo}
											<img
												src={c.away.logo}
												alt=""
												class="h-5 w-5 shrink-0 object-contain"
												loading="lazy"
											/>
										{/if}
										<span class="min-w-0 break-words">{c.away.name}</span>
										<span class="text-sm font-normal text-muted-foreground">({c.away.abbr})</span>
									</span>
								</div>
								{#if c.homeScore !== null && c.awayScore !== null}
									<div class="shrink-0 whitespace-nowrap text-xl font-bold tabular-nums">
										{c.homeScore} – {c.awayScore}
									</div>
								{/if}
							</div>

							<!-- Market -->
							{#if !c.market}
								{#if data.isAdmin && ph === 'upcoming'}
									<form method="POST" action="?/openMarket" use:enhance>
										<input type="hidden" name="eventId" value={c.eventId} />
										<Button type="submit" variant="outline" size="sm">Open</Button>
									</form>
								{:else}
									<p class="text-xs text-muted-foreground">No market yet.</p>
								{/if}
							{:else}
								{@const m = c.market}
								<div class="rounded-md border bg-muted/30 p-3">
									<!-- Pools -->
									<div class="flex flex-wrap gap-x-6 gap-y-1 text-sm">
										{#each allowedSides() as side (side)}
											{@const p = poolFor(m, side)}
											<span>
												<span class="font-medium">{sideLabel(c, side)}</span>
												<span class="text-muted-foreground">
													{p?.total ?? 0} ₡ · {p?.count ?? 0} backer{(p?.count ?? 0) === 1
														? ''
														: 's'}
													· {oddsFor(m, side)}
												</span>
											</span>
										{/each}
									</div>

									{#if m.myWager}
										<p class="mt-2 text-sm">
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
											class="mt-3 flex flex-wrap items-end gap-2"
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
											<Button type="submit" size="sm">
												{m.myWager ? 'Update' : 'Place wager'}
											</Button>
										</form>
									{:else if m.status === 'closed'}
										<p class="mt-2 text-sm text-muted-foreground">
											Wagering closed — awaiting the result.
										</p>
									{:else if m.status === 'resolved'}
										{#if m.winningSide === 'draw'}
											<p class="mt-2 text-sm text-muted-foreground">
												Draw — all wagers pushed (refunded).
											</p>
										{:else}
											<p class="mt-2 text-sm">
												Result: <span class="font-medium">{sideLabel(c, m.winningSide ?? '')}</span> won.
											</p>
										{/if}
									{:else if m.status === 'void'}
										<p class="mt-2 text-sm text-muted-foreground">
											Voided — all wagers refunded.{m.resolutionNote
												? ` (${m.resolutionNote})`
												: ''}
										</p>
									{/if}

									{#if errorFor(m.id)}
										<p class="mt-2 text-sm text-destructive">{errorFor(m.id)}</p>
									{/if}
								</div>
							{/if}
						</CardContent>
					</Card>
				</li>
			{/each}
		</ul>
	{/if}
</div>
