<script lang="ts" module>
	import type { FeedItem } from '$lib/server/feed';

	// Lowercased text used for typeahead search: title, parties, comments, notes.
	export function feedHaystack(item: FeedItem): string {
		let parts: (string | null | undefined)[] = [];
		switch (item.type) {
			case 'bet_created':
				parts = [item.title, item.creator.name, ...item.participants.map((p) => p.name)];
				break;
			case 'bet_resolved':
				parts = [
					item.title,
					item.note,
					...item.winners.map((w) => w.name),
					...item.losers.map((l) => l.name)
				];
				break;
			case 'bet_cancelled':
				parts = [item.title, item.cancelledBy.name];
				break;
			case 'payment':
				parts = [item.from.name, item.to.name, item.memo];
				break;
		}
		return parts.filter(Boolean).join(' ').toLowerCase();
	}
</script>

<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import Avatar from '$lib/components/Avatar.svelte';
	import { formatAmount } from '$lib/format';

	let {
		item,
		locale,
		linkBets = true
	}: { item: FeedItem; locale: string; linkBets?: boolean } = $props();

	const fmt = (n: number) => formatAmount(n, locale);

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
</script>

<Card>
	<CardContent class="py-4">
		<!-- Left → right: bet icon, bet text (with date, wraps), participant
		     avatars (instigator first). On mobile the avatars drop to their own
		     line under the text. -->
		<div class="flex items-start gap-3">
			<div
				class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted/40 text-xl leading-none"
				aria-hidden="true"
			>
				{item.icon ?? '💰'}
			</div>

			<div class="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
				<div class="min-w-0 flex-1 break-words text-sm leading-relaxed">
					{#if item.type === 'bet_created'}
						<Badge variant="gold" class="mr-2 w-24 shrink-0 justify-center align-middle uppercase">bet</Badge>
						<strong>{item.creator.name}</strong> started a bet
						{#if linkBets}<a href={`/app/bet/${item.betId}`} class="font-medium text-primary hover:underline">“{item.title}”</a>{:else}<span class="font-medium">“{item.title}”</span>{/if}
						{#if item.participants.length > 1}
							<span class="text-muted-foreground"> with {nameList(item.participants.filter((p) => p.id !== item.creator.id).map((p) => p.name))}</span>
						{/if}.
					{:else if item.type === 'bet_resolved'}
						<Badge variant="info" class="mr-2 w-24 shrink-0 justify-center align-middle uppercase">resolved</Badge>
						{#if linkBets}<a href={`/app/bet/${item.betId}`} class="font-medium text-primary hover:underline">“{item.title}”</a>{:else}<span class="font-medium">“{item.title}”</span>{/if}
						settled —
						{#if item.winners.length > 0}
							<strong>{nameList(item.winners.map((w) => w.name))}</strong>
							won
							<span class="text-success">+{fmt(item.winners.reduce((s, w) => s + w.amount, 0))} ₡</span>
						{/if}{#if item.winners.length > 0 && item.losers.length > 0}; {/if}
						{#if item.losers.length > 0}
							<span class="text-muted-foreground">{nameList(item.losers.map((l) => l.name))} lost</span>
							<span class="text-destructive">−{fmt(item.losers.reduce((s, l) => s + l.amount, 0))} ₡</span>
						{/if}.{#if item.note}<span class="text-muted-foreground"> — {item.note}</span>{/if}
					{:else if item.type === 'bet_cancelled'}
						<Badge variant="destructive" class="mr-2 w-24 shrink-0 justify-center align-middle uppercase">cancelled</Badge>
						<strong>{item.cancelledBy.name}</strong> called off the bet
						{#if linkBets}<a href={`/app/bet/${item.betId}`} class="font-medium text-primary hover:underline">“{item.title}”</a>{:else}<span class="font-medium">“{item.title}”</span>{/if}.
					{:else if item.type === 'payment'}
						<Badge variant="success" class="mr-2 w-24 shrink-0 justify-center align-middle uppercase">payment</Badge>
						<strong>{item.from.name}</strong> paid <strong>{item.to.name}</strong>
						<span class="text-foreground">{fmt(item.amount)} ₡</span>{#if item.memo}<span class="text-muted-foreground"> — {item.memo}</span>{/if}.
					{/if}
					<span class="text-muted-foreground"> · {fmtDate(item.at)}</span>
				</div>

				<div class="flex flex-wrap gap-1 sm:shrink-0 sm:justify-end">
					{#each item.people as p (p.id)}
						<Avatar id={p.id} name={p.name} avatarUpdatedAt={p.avatarUpdatedAt} size={24} />
					{/each}
				</div>
			</div>
		</div>
	</CardContent>
</Card>
