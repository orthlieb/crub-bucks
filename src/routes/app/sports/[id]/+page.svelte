<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Market = PageData['market'];

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

	const sides: ('home' | 'away')[] = ['home', 'away'];
	function sideName(m: Market, side: string | null): string {
		if (side === 'home') return m.homeAbbr || m.homeName;
		if (side === 'away') return m.awayAbbr || m.awayName;
		return 'Draw';
	}
	function sideLogo(m: Market, side: string): string | null {
		return side === 'home' ? m.homeLogo : side === 'away' ? m.awayLogo : null;
	}
	function poolFor(m: Market, side: string) {
		return m.pools.find((p) => p.side === side);
	}
	function totalPool(m: Market): number {
		return m.pools.reduce((s, p) => s + p.total, 0);
	}
	function oddsFor(m: Market, side: string): string {
		const p = poolFor(m, side)?.total ?? 0;
		const t = totalPool(m);
		if (p <= 0 || t <= 0) return '—';
		return `${Math.round((t / p - 1) * 10) / 10}:1`;
	}

	const m = $derived(data.market);
	const open = $derived(m.status === 'open');
</script>

<div class="space-y-6">
	<a
		href="/app/sports"
		class="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
	>
		<ChevronLeft class="size-4" /> Sports
	</a>

	<header class="flex items-center gap-3">
		{#if m.leagueLogo}
			<img src={m.leagueLogo} alt="" class="h-10 w-10 shrink-0 object-contain" />
		{/if}
		<div class="min-w-0">
			<h1 class="text-2xl font-bold tracking-tight">{m.homeName} vs {m.awayName}</h1>
			<p class="text-sm text-muted-foreground">
				{m.league}{#if mounted}
					· {kickoff(m.startTime)}{/if}
			</p>
		</div>
	</header>

	<!-- Pools / odds -->
	<Card>
		<CardContent class="space-y-3 py-4">
			<h2 class="text-sm font-semibold">Pools</h2>
			<div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
				{#each sides as side (side)}
					{@const p = poolFor(m, side)}
					<div class="flex items-center gap-2 rounded-md border p-3">
						{#if sideLogo(m, side)}
							<img src={sideLogo(m, side)} alt="" class="h-6 w-6 object-contain" />
						{/if}
						<div class="min-w-0">
							<div class="font-medium">{sideName(m, side)}</div>
							<div class="text-xs text-muted-foreground">
								{p?.total ?? 0} ₡ · {p?.count ?? 0} backer{(p?.count ?? 0) === 1 ? '' : 's'} · {oddsFor(
									m,
									side
								)}
							</div>
						</div>
					</div>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
				Parimutuel: backers of the winning side split the losers' pool, proportional to stake. Odds
				are profit-to-stake and shift as bets come in. If only one side has bets by game time, the
				market pushes (everyone refunded).
			</p>
		</CardContent>
	</Card>

	<!-- Your wager / result -->
	{#if m.myWager}
		<Card>
			<CardContent class="py-4 text-sm">
				Your wager: <span class="font-medium"
					>{m.myWager.stake} ₡ on {sideName(m, m.myWager.side)}</span
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
			</CardContent>
		</Card>
	{/if}

	<!-- Bet form / status -->
	{#if open}
		<Card>
			<CardContent class="space-y-3 py-4">
				<h2 class="text-sm font-semibold">{m.myWager ? 'Update your bet' : 'Place a bet'}</h2>
				<p class="text-xs text-muted-foreground">Balance: {data.balance} ₡</p>
				<form
					method="POST"
					action="?/placeWager"
					use:enhance
					class="flex flex-wrap items-end gap-2"
				>
					<label class="text-sm">
						<span class="block text-xs text-muted-foreground">Pick</span>
						<select
							name="side"
							class="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
						>
							{#each sides as side (side)}
								<option value={side} selected={m.myWager?.side === side}>{sideName(m, side)}</option
								>
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
							value={m.myWager?.stake ?? ''}
							required
							class="w-28"
						/>
					</label>
					<Button type="submit" size="sm">{m.myWager ? 'Update' : 'Bet'}</Button>
				</form>
				{#if form && 'message' in form}
					<p class="text-sm text-destructive">{form.message}</p>
				{/if}
			</CardContent>
		</Card>
	{:else if m.status === 'void'}
		<Card>
			<CardContent class="py-4 text-sm text-muted-foreground">
				{m.resolutionNote ?? 'Pushed — all wagers refunded.'}
			</CardContent>
		</Card>
	{:else if m.status === 'resolved'}
		<Card>
			<CardContent class="py-4 text-sm">
				{#if m.winningSide === 'draw'}
					Draw — all wagers pushed (refunded).
				{:else}
					Result: <span class="font-medium">{sideName(m, m.winningSide)}</span> won.
				{/if}
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardContent class="py-4 text-sm text-muted-foreground">
				Wagering closed — awaiting the result.
			</CardContent>
		</Card>
	{/if}
</div>
