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

	let { data, form }: { data: PageData; form: ActionData } = $props();

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

	const SPORT_LABELS: Record<string, string> = { cfl: 'CFL', mma: 'MMA' };
	const sportLabel = (s: string) => SPORT_LABELS[s] ?? s.charAt(0).toUpperCase() + s.slice(1);

	let selectedSport = $state('all');
	let query = $state('');
	const pill = (active: boolean) =>
		cn(
			'rounded-full border px-3 py-1 text-xs transition-colors',
			active
				? 'border-primary bg-accent font-medium text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent'
		);

	const shown = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.games.filter((g) => {
			if (selectedSport !== 'all' && g.sport !== selectedSport) return false;
			if (q) {
				const hay =
					`${g.home.name} ${g.home.abbr} ${g.away.name} ${g.away.abbr} ${g.league} ${g.sport}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	});

	const errorFor = (eventId: string) =>
		form && 'eventId' in form && form.eventId === eventId && 'message' in form
			? (form.message as string)
			: null;
</script>

<div class="space-y-6">
	<a href="/app/sports" class="text-sm text-muted-foreground hover:text-foreground">← Sports</a>

	<header>
		<h1 class="text-3xl font-bold tracking-tight">Bet on a game</h1>
		<p class="mt-1 text-muted-foreground">
			Pick an upcoming game and place the first wager — that opens the market.
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
		<div class="relative">
			<Search
				class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
			/>
			<Input
				type="search"
				bind:value={query}
				placeholder="Search teams or leagues…"
				aria-label="Search teams or leagues"
				class="pl-9"
			/>
		</div>
		{#if data.sports.length > 1}
			<div class="flex flex-wrap gap-2">
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
	</div>

	{#if data.games.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				No upcoming games available to bet on right now.
			</CardContent>
		</Card>
	{:else if shown.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				No games match your search.
			</CardContent>
		</Card>
	{:else}
		<ul class="space-y-3">
			{#each shown as g (g.eventId)}
				<li>
					<Card>
						<CardContent class="space-y-3 py-4">
							<div class="flex items-center justify-between gap-3">
								<div class="flex min-w-0 items-center gap-2">
									{#if g.leagueLogo}
										<img src={g.leagueLogo} alt="" class="h-5 w-5 shrink-0 object-contain" />
									{/if}
									<span class="text-xs text-muted-foreground">{g.league}</span>
								</div>
								<span class="shrink-0 text-xs text-muted-foreground"
									>{mounted ? kickoff(g.startTime) : ''}</span
								>
							</div>

							<div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-lg font-semibold">
								<span class="inline-flex items-center gap-1.5">
									{#if g.home.logo}
										<img src={g.home.logo} alt="" class="h-5 w-5 object-contain" loading="lazy" />
									{/if}
									{g.home.name}
								</span>
								<span class="text-sm text-muted-foreground">vs</span>
								<span class="inline-flex items-center gap-1.5">
									{#if g.away.logo}
										<img src={g.away.logo} alt="" class="h-5 w-5 object-contain" loading="lazy" />
									{/if}
									{g.away.name}
								</span>
							</div>

							<form method="POST" action="?/bet" use:enhance class="flex flex-wrap items-end gap-2">
								<input type="hidden" name="eventId" value={g.eventId} />
								<label class="text-sm">
									<span class="block text-xs text-muted-foreground">Pick</span>
									<select
										name="side"
										class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
									>
										<option value="home">{g.home.abbr || g.home.name}</option>
										<option value="away">{g.away.abbr || g.away.name}</option>
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
								<Button type="submit" size="sm">Bet</Button>
							</form>

							{#if errorFor(g.eventId)}
								<p class="text-sm text-destructive">{errorFor(g.eventId)}</p>
							{/if}
						</CardContent>
					</Card>
				</li>
			{/each}
		</ul>
	{/if}
</div>
