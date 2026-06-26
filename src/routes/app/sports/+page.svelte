<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Input } from '$lib/components/ui/input';

	let { data }: { data: PageData } = $props();

	// Kickoff times are formatted CLIENT-SIDE only, so they render in the
	// visitor's own timezone. Formatting on the server would use the VPS
	// timezone (UTC) and disagree with the browser on hydration. We render a
	// neutral placeholder until mounted so SSR and the first client paint match
	// (no hydration mismatch), then swap in the real local-time string.
	let mounted = $state(false);
	onMount(() => {
		mounted = true;
	});

	// Element type inferred from the loader — avoids importing from $lib/server
	// (which SvelteKit blocks in client code, even for type-only imports).
	type Ev = PageData['events'][number];

	const STATUS_LABEL: Record<string, string> = {
		scheduled: 'Upcoming',
		in_progress: 'Live',
		final: 'Final',
		postponed: 'Postponed',
		cancelled: 'Cancelled'
	};

	// Tailwind classes for each status pill — driven by the design tokens already
	// used across the app (accent / destructive / muted / primary).
	const STATUS_CLASS: Record<string, string> = {
		scheduled: 'bg-muted text-muted-foreground',
		in_progress: 'bg-primary text-primary-foreground',
		final: 'bg-accent text-accent-foreground',
		postponed: 'bg-destructive/10 text-destructive',
		cancelled: 'bg-destructive/10 text-destructive'
	};

	function kickoff(iso: string): string {
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '';
		// Locale from the user's Accept-Language (root layout); timezone is the
		// browser's own, since this only runs after mount.
		return d.toLocaleString(data.locale, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		});
	}

	function scoreline(e: Ev): string {
		if (e.homeScore === null || e.awayScore === null) return '';
		return `${e.homeScore} – ${e.awayScore}`;
	}

	function sportLabel(s: string): string {
		return s.charAt(0).toUpperCase() + s.slice(1);
	}

	// Client-side filters: sport (chips), status (chips), and a team-name search.
	let selectedSport = $state('all');
	let selectedStatus = $state('all');
	let query = $state('');

	const STATUS_FILTERS = [
		{ key: 'all', label: 'All' },
		{ key: 'scheduled', label: 'Upcoming' },
		{ key: 'in_progress', label: 'Live' },
		{ key: 'final', label: 'Final' }
	];

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.events.filter((e) => {
			if (selectedSport !== 'all' && e.sport !== selectedSport) return false;
			if (selectedStatus !== 'all' && e.status !== selectedStatus) return false;
			if (q) {
				const hay = `${e.home.name} ${e.home.abbr} ${e.away.name} ${e.away.abbr}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});
</script>

<div class="space-y-6">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Sports</h1>
		<p class="mt-1 text-muted-foreground">
			Upcoming games and results from the sports feed. Read-only preview — you can't bet on these
			yet.
		</p>
	</header>

	{#if data.provider === 'mock'}
		<Alert variant="warning">
			<AlertTitle>Sample data</AlertTitle>
			<AlertDescription>
				The feed is running in <code>mock</code> mode, so these matchups and scores are
				<strong>invented sample fixtures</strong>, not real results. Point
				<code>SPORTS_FEED=espn</code> at a live provider (and allowlist its host) to show real games.
			</AlertDescription>
		</Alert>
	{/if}

	<div class="space-y-3">
		<Input
			type="search"
			bind:value={query}
			placeholder="Search teams…"
			aria-label="Search teams"
			class="max-w-xs"
		/>

		{#if data.sports.length > 1}
			<div class="flex flex-wrap gap-2">
				{#each ['all', ...data.sports] as s (s)}
					<button
						type="button"
						onclick={() => (selectedSport = s)}
						class="rounded-full border px-3 py-1 text-sm transition-colors {selectedSport === s
							? 'border-primary bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:bg-accent'}"
					>
						{s === 'all' ? 'All' : sportLabel(s)}
					</button>
				{/each}
			</div>
		{/if}

		<div class="flex flex-wrap gap-2">
			{#each STATUS_FILTERS as f (f.key)}
				<button
					type="button"
					onclick={() => (selectedStatus = f.key)}
					class="rounded-full border px-3 py-1 text-sm transition-colors {selectedStatus === f.key
						? 'border-primary bg-primary text-primary-foreground'
						: 'text-muted-foreground hover:bg-accent'}"
				>
					{f.label}
				</button>
			{/each}
		</div>
	</div>

	{#if shown.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				No games available from the feed right now.
			</CardContent>
		</Card>
	{:else}
		<ul class="space-y-3">
			{#each shown as e (e.provider + ':' + e.eventId)}
				<li>
					<Card>
						<CardContent class="flex items-center justify-between gap-4 py-4">
							<div class="min-w-0">
								<div class="flex items-center gap-2">
									<span
										class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium {STATUS_CLASS[
											e.status
										]}"
									>
										{STATUS_LABEL[e.status]}
									</span>
									<span class="truncate text-xs text-muted-foreground"
										>{mounted ? kickoff(e.startTime) : ''}</span
									>
								</div>
								<div class="mt-1.5 flex items-center gap-2 text-lg font-semibold">
									<span
										class="inline-flex items-center gap-1.5"
										class:opacity-50={e.winner === 'away'}
									>
										{#if e.home.logo}
											<img src={e.home.logo} alt="" class="h-5 w-5 object-contain" loading="lazy" />
										{/if}
										{e.home.name}
										<span class="text-sm font-normal text-muted-foreground">({e.home.abbr})</span>
									</span>
									<span class="text-sm text-muted-foreground">vs</span>
									<span
										class="inline-flex items-center gap-1.5"
										class:opacity-50={e.winner === 'home'}
									>
										{#if e.away.logo}
											<img src={e.away.logo} alt="" class="h-5 w-5 object-contain" loading="lazy" />
										{/if}
										{e.away.name}
										<span class="text-sm font-normal text-muted-foreground">({e.away.abbr})</span>
									</span>
								</div>
								<p class="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
									{#if e.leagueLogo}
										<img src={e.leagueLogo} alt="" class="h-4 w-4 object-contain" loading="lazy" />
									{/if}
									{e.league}
								</p>
							</div>
							<div class="shrink-0 text-right">
								{#if scoreline(e)}
									<div class="text-xl font-bold tabular-nums">{scoreline(e)}</div>
								{/if}
								{#if e.status === 'final'}
									<div class="text-xs text-muted-foreground">
										{#if e.winner === 'draw'}
											Draw
										{:else if e.winner === 'home'}
											{e.home.abbr} win
										{:else if e.winner === 'away'}
											{e.away.abbr} win
										{/if}
									</div>
								{/if}
							</div>
						</CardContent>
					</Card>
				</li>
			{/each}
		</ul>
	{/if}
</div>
