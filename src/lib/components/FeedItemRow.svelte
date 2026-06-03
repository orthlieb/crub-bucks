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
	import BetCard, { type BetTone } from '$lib/components/BetCard.svelte';
	import { resolvedSummary, cancelledSummary } from '$lib/bet-summary';

	let {
		item,
		locale,
		linkBets = true
	}: { item: FeedItem; locale: string; linkBets?: boolean } = $props();

	// State → icon-box label + tone.
	const STATE: Record<FeedItem['type'], { label: string; tone: BetTone }> = {
		bet_created: { label: 'Bet', tone: 'amber' },
		bet_resolved: { label: 'Resolved', tone: 'blue' },
		bet_cancelled: { label: 'Cancelled', tone: 'red' },
		payment: { label: 'Payment', tone: 'green' }
	};
	const state = $derived(STATE[item.type]);

	// Standardised body shared with the dashboard: title, amount, comment, date.
	const title = $derived(
		item.type === 'payment' ? `${item.from.name} paid ${item.to.name}` : item.title
	);
	// Resolved/cancelled auto-generate a summary when there's no written note;
	// payments show their memo; created bets get nothing.
	const comment = $derived.by(() => {
		switch (item.type) {
			case 'bet_resolved':
				return item.note ?? resolvedSummary(item.winners.map((w) => w.name));
			case 'bet_cancelled':
				return cancelledSummary(item.cancelledBy.name);
			case 'payment':
				return item.memo;
			default:
				return null;
		}
	});
	const href = $derived(linkBets && item.type !== 'payment' ? `/app/bet/${item.betId}` : undefined);
</script>

<BetCard
	icon={item.icon}
	label={state.label}
	tone={state.tone}
	{title}
	amount={item.amount}
	{comment}
	date={item.at}
	{locale}
	{href}
	people={item.people}
/>
