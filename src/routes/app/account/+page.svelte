<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { formatAmount } from '$lib/format';
	import { cn } from '$lib/utils';
	import Wallet from '@lucide/svelte/icons/wallet';
	import Search from '@lucide/svelte/icons/search';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import FilterX from '@lucide/svelte/icons/filter-x';

	type Entry = PageData['statement'][number];

	let { data }: { data: PageData } = $props();
	const fmt = (n: number) => formatAmount(n, data.locale);

	function signed(n: number): string {
		return n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : fmt(0);
	}
	function deltaClass(n: number): string {
		return n > 0 ? 'text-success' : n < 0 ? 'text-destructive' : 'text-muted-foreground';
	}
	function fmtDate(d: Date | string): string {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	// Primary description for a row: bet context > memo > a generic payment line.
	function describe(e: Entry): string {
		if (e.betTitle) return e.betTitle;
		if (e.memo) return e.memo;
		return e.delta > 0 ? `Received from ${e.counterparty}` : `Paid to ${e.counterparty}`;
	}
	function subtitle(e: Entry): string {
		const dir = e.delta > 0 ? `from ${e.counterparty}` : `to ${e.counterparty}`;
		return `${dir} · ${fmtDate(e.createdAt)}`;
	}
	function entryType(e: Entry): 'bet' | 'grant' | 'payment' {
		if (e.betId) return 'bet';
		if (e.counterparty === 'The Bank') return 'grant';
		return 'payment';
	}

	const balanceClass = $derived(
		data.balance > 0 ? 'text-success' : data.balance < 0 ? 'text-destructive' : 'text-foreground'
	);

	// --- filters (all client-side over the loaded statement → instant) --------
	// Design mirrors Iron Ledger: a search box, a collapsible "Filters" panel
	// with rounded TYPE/FLOW pill chips, and a clear-filters control.
	let query = $state('');
	let typeFilter = $state<'all' | 'bet' | 'payment' | 'grant'>('all');
	let dir = $state<'all' | 'in' | 'out'>('all');
	let filtersOpen = $state(true);

	const typeChips = [
		{ value: 'all', label: 'All' },
		{ value: 'bet', label: 'Bets' },
		{ value: 'payment', label: 'Payments' },
		{ value: 'grant', label: 'Grants' }
	] as const;
	const dirChips = [
		{ value: 'all', label: 'All' },
		{ value: 'in', label: 'In' },
		{ value: 'out', label: 'Out' }
	] as const;

	// Rounded pill, filled when active (Iron Ledger style).
	const pill = (active: boolean) =>
		cn(
			'rounded-full border px-3 py-1 text-xs transition-colors',
			active
				? 'border-primary bg-accent font-medium text-accent-foreground'
				: 'text-muted-foreground hover:bg-accent'
		);

	function haystack(e: Entry): string {
		return `${describe(e)} ${e.counterparty} ${e.memo ?? ''} ${e.betTitle ?? ''}`.toLowerCase();
	}

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.statement.filter((e) => {
			if (typeFilter !== 'all' && entryType(e) !== typeFilter) return false;
			if (dir === 'in' && e.delta <= 0) return false;
			if (dir === 'out' && e.delta >= 0) return false;
			if (q && !haystack(e).includes(q)) return false;
			return true;
		});
	});
	const isFiltering = $derived(query.trim() !== '' || typeFilter !== 'all' || dir !== 'all');

	function clearFilters() {
		query = '';
		typeFilter = 'all';
		dir = 'all';
	}
</script>

<div class="space-y-6">
	<header class="flex items-center gap-3">
		<div
			class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
		>
			<Wallet class="h-8 w-8" />
		</div>
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Account</h1>
			<p class="mt-1 text-muted-foreground">Your Crub Bucks statement — every debit and credit.</p>
		</div>
	</header>

	<!-- Current balance -->
	<Card>
		<CardContent class="flex items-baseline justify-between py-5">
			<span class="text-sm font-medium text-muted-foreground">Current balance</span>
			<span class="text-3xl font-bold tabular-nums {balanceClass}">{fmt(data.balance)} ₡</span>
		</CardContent>
	</Card>

	{#if data.statement.length === 0}
		<Card>
			<CardContent class="flex flex-col items-center gap-4 py-10 text-center">
				<img
					src="/cala-napping.png"
					alt="Cala napping"
					width="160"
					height="160"
					class="max-h-32 w-auto select-none opacity-90"
					draggable="false"
				/>
				<p class="text-muted-foreground">
					No transactions yet. Make a bet or send a friend some bucks.
				</p>
			</CardContent>
		</Card>
	{:else}
		<!-- Filters (Iron Ledger style: search + collapsible TYPE/FLOW pills) -->
		<div class="space-y-3">
			<div class="relative">
				<Search
					class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="search"
					bind:value={query}
					placeholder="Search transactions, people, notes…"
					aria-label="Search your statement"
					class="pl-9"
				/>
			</div>

			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => (filtersOpen = !filtersOpen)}
					aria-expanded={filtersOpen}
					class="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
				>
					Filters
					<ChevronDown class={cn('size-4 transition-transform', filtersOpen && 'rotate-180')} />
				</button>
				{#if isFiltering}
					<button
						type="button"
						onclick={clearFilters}
						class="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent"
					>
						<FilterX class="size-4" />
						Clear
					</button>
				{/if}
			</div>

			{#if filtersOpen}
				<div class="space-y-3 rounded-md border bg-muted/20 p-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="w-12 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Type
						</span>
						{#each typeChips as t (t.value)}
							<button
								type="button"
								class={pill(typeFilter === t.value)}
								onclick={() => (typeFilter = t.value)}
							>
								{t.label}
							</button>
						{/each}
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<span class="w-12 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Flow
						</span>
						{#each dirChips as d (d.value)}
							<button type="button" class={pill(dir === d.value)} onclick={() => (dir = d.value)}>
								{d.label}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		{#if filtered.length === 0}
			<Card>
				<CardContent class="py-10 text-center text-muted-foreground">
					No transactions match your filters.
				</CardContent>
			</Card>
		{:else}
			<Card>
				<CardContent class="p-0">
					<ul class="divide-y">
						{#each filtered as e (e.id)}
							{@const row = describe(e)}
							<li class="flex items-center gap-3 px-4 py-3">
								<div
									class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted/50 text-lg leading-none"
								>
									{e.icon ?? (e.betId ? '🎲' : e.delta > 0 ? '⬇️' : '⬆️')}
								</div>
								<div class="min-w-0 flex-1">
									<div class="truncate font-medium">
										{#if e.betId}
											<a href={`/app/bet/${e.betId}`} class="hover:underline">{row}</a>
										{:else}
											{row}
										{/if}
									</div>
									<div class="truncate text-xs text-muted-foreground">{subtitle(e)}</div>
								</div>
								<div class="shrink-0 text-right">
									<div class="font-medium tabular-nums {deltaClass(e.delta)}">
										{signed(e.delta)} ₡
									</div>
									<div class="text-xs tabular-nums text-muted-foreground">
										{fmt(e.balanceAfter)} ₡
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</CardContent>
			</Card>
		{/if}

		<p class="text-center text-xs text-muted-foreground">
			{#if isFiltering}
				Showing {filtered.length} of {data.statement.length} transactions.
			{:else}
				Showing your most recent {data.statement.length} transactions.
			{/if}
		</p>
	{/if}
</div>
