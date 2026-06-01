<script lang="ts">
	import type { PageData } from './$types';
	import type { FeedItem, FeedUser } from '$lib/server/feed';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import Avatar from '$lib/components/Avatar.svelte';
	import { formatAmount } from '$lib/format';

	let { data }: { data: PageData } = $props();
	const fmt = (n: number) => formatAmount(n, data.locale);

	// The person whose avatar leads the row — the actor behind the event.
	function actor(item: FeedItem): FeedUser | null {
		switch (item.type) {
			case 'bet_created':
				return item.creator;
			case 'bet_cancelled':
				return item.cancelledBy;
			case 'payment':
				return item.from;
			case 'bet_resolved':
				return item.winners[0] ?? item.losers[0] ?? null;
		}
	}

	function fmtDate(d: Date | string): string {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	// "A", "A & B", "A, B & C"
	function nameList(names: string[]): string {
		if (names.length === 0) return 'nobody';
		if (names.length === 1) return names[0];
		if (names.length === 2) return `${names[0]} & ${names[1]}`;
		return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
	}

	function bankClass(n: number): string {
		if (n > 0) return 'text-success';
		if (n < 0) return 'text-destructive';
		return 'text-muted-foreground';
	}
</script>

<div class="space-y-6">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Feed</h1>
			<p class="mt-1 text-muted-foreground">
				{data.mine ? 'Just the bets and payments you’re in.' : "What everyone's been up to."}
			</p>
		</div>
		<div class="text-right">
			<div class="text-xs uppercase tracking-wide text-muted-foreground">The Bank</div>
			<div class="text-2xl font-bold tabular-nums {bankClass(data.bank)}">
				{fmt(data.bank)} ₡
			</div>
		</div>
	</header>

	<div class="inline-flex rounded-md border p-0.5 text-sm">
		<a
			href="/app/feed"
			class="rounded-sm px-3 py-1.5 transition-colors {data.mine
				? 'text-muted-foreground hover:bg-accent'
				: 'bg-accent font-medium text-foreground'}"
			aria-current={data.mine ? undefined : 'page'}
		>
			Everyone
		</a>
		<a
			href="/app/feed?mine=1"
			class="rounded-sm px-3 py-1.5 transition-colors {data.mine
				? 'bg-accent font-medium text-foreground'
				: 'text-muted-foreground hover:bg-accent'}"
			aria-current={data.mine ? 'page' : undefined}
		>
			Just me
		</a>
	</div>

	{#if data.items.length === 0}
		<Card>
			<CardContent class="flex flex-col items-center gap-3 py-10 text-center text-muted-foreground">
				<img
					src="/cala-empty-feed.png"
					alt="Cala the dog flopped down with her chin on her paws — nothing's happening."
					width="260"
					height="260"
					class="h-32 w-auto select-none opacity-90"
				/>
				{#if data.mine}
					You're not in anything yet. Start a bet or pay a friend.
				{:else}
					Nothing's happened yet. Make a bet or pay a friend to kick things off.
				{/if}
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-2">
			{#each data.items as item (item.id)}
				<Card>
					<CardContent class="py-4">
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-start gap-3">
								{#if actor(item)}
									{@const a = actor(item)}
									{#if a}
										<Avatar id={a.id} name={a.name} avatarUpdatedAt={a.avatarUpdatedAt} size={36} class="mt-0.5" />
									{/if}
								{/if}
								<div class="text-sm leading-relaxed">
								{#if item.type === 'bet_created'}
									<Badge variant="gold" class="mr-2 w-24 justify-center align-middle uppercase">bet</Badge>
									<strong>{item.creator.name}</strong> started a bet
									<a href={`/app/bet/${item.betId}`} class="font-medium text-primary hover:underline">“{item.title}”</a>
									{#if item.participants.length > 1}
										<span class="text-muted-foreground"> with {nameList(item.participants.filter((p) => p.id !== item.creator.id).map((p) => p.name))}</span>
									{/if}.
								{:else if item.type === 'bet_resolved'}
									<Badge variant="info" class="mr-2 w-24 justify-center align-middle uppercase">resolved</Badge>
									<a href={`/app/bet/${item.betId}`} class="font-medium text-primary hover:underline">“{item.title}”</a>
									settled —
									{#if item.winners.length > 0}
										<strong>{nameList(item.winners.map((w) => w.name))}</strong>
										{item.winners.length > 1 ? 'won' : 'won'}
										<span class="text-success">+{fmt(item.winners.reduce((s, w) => s + w.amount, 0))} ₡</span>
									{/if}{#if item.winners.length > 0 && item.losers.length > 0}; {/if}
									{#if item.losers.length > 0}
										<span class="text-muted-foreground">{nameList(item.losers.map((l) => l.name))} lost</span>
										<span class="text-destructive">−{fmt(item.losers.reduce((s, l) => s + l.amount, 0))} ₡</span>
									{/if}.{#if item.note}<span class="text-muted-foreground"> — {item.note}</span>{/if}
								{:else if item.type === 'bet_cancelled'}
									<Badge variant="destructive" class="mr-2 w-24 justify-center align-middle uppercase">cancelled</Badge>
									<strong>{item.cancelledBy.name}</strong> called off the bet
									<a href={`/app/bet/${item.betId}`} class="font-medium text-primary hover:underline">“{item.title}”</a>.
								{:else if item.type === 'payment'}
									<Badge variant="success" class="mr-2 w-24 justify-center align-middle uppercase">payment</Badge>
									{#if item.icon}<span class="mr-1 align-middle text-lg leading-none">{item.icon}</span>{/if}
									<strong>{item.from.name}</strong> paid <strong>{item.to.name}</strong>
									<span class="text-foreground">{fmt(item.amount)} ₡</span>{#if item.memo}<span class="text-muted-foreground"> — {item.memo}</span>{/if}.
								{/if}
								</div>
							</div>
							<time class="shrink-0 text-xs text-muted-foreground">{fmtDate(item.at)}</time>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>
