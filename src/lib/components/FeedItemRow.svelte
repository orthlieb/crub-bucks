<script lang="ts" module>
	import type { FeedItem } from '$lib/server/feed';
	import { BADGES_BY_KEY } from '$lib/badges';

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
			case 'badge_earned':
				parts = [item.earner.name, BADGES_BY_KEY.get(item.badgeKey)?.title];
				break;
		}
		return parts.filter(Boolean).join(' ').toLowerCase();
	}
</script>

<script lang="ts">
	import BetCard, { type BetTone } from '$lib/components/BetCard.svelte';
	import { resolvedSummary, cancelledSummary } from '$lib/bet-summary';
	import { TIER_LABEL, TIER_EMOJI, badgeIcon } from '$lib/badges';

	let {
		item,
		locale,
		linkBets = true
	}: { item: FeedItem; locale: string; linkBets?: boolean } = $props();

	// State → icon-box label + tone (non-badge types; badges are tier-dependent).
	const STATE = {
		bet_created: { label: 'Bet', tone: 'amber' },
		bet_resolved: { label: 'Resolved', tone: 'blue' },
		bet_cancelled: { label: 'Cancelled', tone: 'red' },
		payment: { label: 'Payment', tone: 'green' }
	} as const satisfies Record<string, { label: string; tone: BetTone }>;

	const badgeDef = $derived(
		item.type === 'badge_earned' ? BADGES_BY_KEY.get(item.badgeKey) : undefined
	);

	const label = $derived(
		item.type === 'badge_earned' ? TIER_LABEL[item.tier] : STATE[item.type].label
	);
	const tone: BetTone = $derived(
		item.type === 'badge_earned' ? 'violet' : STATE[item.type].tone
	);
	const icon = $derived(
		item.type === 'badge_earned' ? (badgeDef?.emoji ?? '🏅') : item.icon
	);
	// Badge feed items prefer the tier art PNG over the emoji (which doesn't
	// theme well); BetCard falls back to `icon` if the image fails to load.
	const iconImg = $derived(
		item.type === 'badge_earned' ? badgeIcon(item.badgeKey, item.tier) : null
	);
	const amount = $derived(item.type === 'badge_earned' ? null : item.amount);

	// Standardised body shared with the dashboard: title, amount, comment, date.
	const title = $derived.by(() => {
		if (item.type === 'payment') return `${item.from.name} paid ${item.to.name}`;
		if (item.type === 'badge_earned')
			return `${item.earner.name} earned ${badgeDef?.title ?? 'a badge'}`;
		return item.title;
	});
	// Resolved/cancelled auto-generate a summary when there's no written note;
	// payments show their memo; badges show the tier; created bets get nothing.
	const comment = $derived.by(() => {
		switch (item.type) {
			case 'bet_resolved':
				return item.note ?? resolvedSummary(item.winners.map((w) => w.name));
			case 'bet_cancelled':
				return cancelledSummary(item.cancelledBy.name);
			case 'payment':
				return item.memo;
			case 'badge_earned':
				return `${TIER_EMOJI[item.tier]} ${TIER_LABEL[item.tier]} tier`;
			default:
				return null;
		}
	});
	const href = $derived(
		linkBets && (item.type === 'bet_created' || item.type === 'bet_resolved' || item.type === 'bet_cancelled')
			? `/app/bet/${item.betId}`
			: undefined
	);
</script>

<BetCard
	{icon}
	{iconImg}
	{label}
	{tone}
	{title}
	{amount}
	{comment}
	date={item.at}
	{locale}
	{href}
	people={item.people}
/>
