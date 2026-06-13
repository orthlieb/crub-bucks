<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { formatAmount } from '$lib/format';
	import Wallet from '@lucide/svelte/icons/wallet';

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
	function describe(e: PageData['statement'][number]): string {
		if (e.betTitle) return e.betTitle;
		if (e.memo) return e.memo;
		return e.delta > 0 ? `Received from ${e.counterparty}` : `Paid to ${e.counterparty}`;
	}
	function subtitle(e: PageData['statement'][number]): string {
		const dir = e.delta > 0 ? `from ${e.counterparty}` : `to ${e.counterparty}`;
		return `${dir} · ${fmtDate(e.createdAt)}`;
	}

	const balanceClass = $derived(
		data.balance > 0 ? 'text-success' : data.balance < 0 ? 'text-destructive' : 'text-foreground'
	);
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
		<Card>
			<CardContent class="p-0">
				<ul class="divide-y">
					{#each data.statement as e (e.id)}
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
		<p class="text-center text-xs text-muted-foreground">
			Showing your most recent {data.statement.length} transactions.
		</p>
	{/if}
</div>
