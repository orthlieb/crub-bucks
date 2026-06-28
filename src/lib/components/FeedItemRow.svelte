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
			case 'sports_settled':
				parts = [
					item.homeName,
					item.awayName,
					item.homeAbbr,
					item.awayAbbr,
					item.league,
					...item.winners.map((w) => w.name),
					...item.losers.map((l) => l.name)
				];
				break;
		}
		return parts.filter(Boolean).join(' ').toLowerCase();
	}
</script>

<script lang="ts">
	import BetCard, { type BetTone } from '$lib/components/BetCard.svelte';
	import { resolvedSummary, cancelledSummary } from '$lib/bet-summary';
	import { TIER_LABEL, badgeIcon, tierBug } from '$lib/badges';

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
		payment: { label: 'Payment', tone: 'green' },
		sports_settled: { label: 'Sports', tone: 'blue' }
	} as const satisfies Record<string, { label: string; tone: BetTone }>;

	const badgeDef = $derived(
		item.type === 'badge_earned' ? BADGES_BY_KEY.get(item.badgeKey) : undefined
	);

	const label = $derived(
		item.type === 'badge_earned' ? TIER_LABEL[item.tier] : STATE[item.type].label
	);
	const tone: BetTone = $derived(item.type === 'badge_earned' ? 'violet' : STATE[item.type].tone);
	const icon = $derived(
		item.type === 'badge_earned'
			? (badgeDef?.emoji ?? '🏅')
			: item.type === 'sports_settled'
				? '🏆'
				: item.icon
	);
	// The winning team's crest for a settled sports item (null on push/no-bets/draw).
	const sportsWinnerLogo = $derived.by(() => {
		if (item.type !== 'sports_settled') return null;
		if (item.winningSide === 'home') return item.homeLogo;
		if (item.winningSide === 'away') return item.awayLogo;
		return null;
	});
	// Badge items prefer the tier art PNG; a settled sports item shows the WINNING
	// team's logo (falling back to the league/franchise mark). BetCard falls back
	// to `icon` (emoji) if the image fails to load.
	const iconImg = $derived(
		item.type === 'badge_earned'
			? badgeIcon(item.badgeKey, item.tier)
			: item.type === 'sports_settled'
				? (sportsWinnerLogo ?? item.leagueLogo)
				: null
	);

	// Standardised body shared with the dashboard: title, amount, comment, date.
	const title = $derived.by(() => {
		if (item.type === 'payment') return `${item.from.name} paid ${item.to.name}`;
		if (item.type === 'badge_earned')
			return `${item.earner.name} earned ${badgeDef?.title ?? 'a badge'}`;
		if (item.type === 'sports_settled') return `${item.homeName} vs ${item.awayName}`;
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
				// Rendered via the tierBugComment snippet (image, not text).
				return null;
			default:
				return null;
		}
	});
	const href = $derived.by(() => {
		if (!linkBets) return undefined;
		if (
			item.type === 'bet_created' ||
			item.type === 'bet_resolved' ||
			item.type === 'bet_cancelled'
		)
			return `/app/bet/${item.betId}`;
		if (item.type === 'sports_settled') return `/app/sports/${item.marketId}`;
		return undefined;
	});
</script>

{#snippet tierBugComment()}
	{#if item.type === 'badge_earned'}
		<span class="inline-flex items-center gap-1">
			<img src={tierBug(item.tier)} alt="" class="inline-block h-4 w-4 object-contain" />
			{TIER_LABEL[item.tier]} tier
		</span>
	{/if}
{/snippet}

{#snippet sportsComment()}
	{#if item.type === 'sports_settled'}
		<span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
			<span class="inline-flex items-center gap-1">
				{#if item.homeLogo}
					<img src={item.homeLogo} alt="" class="inline-block h-4 w-4 object-contain" />
				{/if}
				{item.homeAbbr}
			</span>
			<span class="text-muted-foreground">vs</span>
			<span class="inline-flex items-center gap-1">
				{#if item.awayLogo}
					<img src={item.awayLogo} alt="" class="inline-block h-4 w-4 object-contain" />
				{/if}
				{item.awayAbbr}
			</span>
			{#if item.homeScore !== null && item.awayScore !== null}
				<span class="text-muted-foreground">·</span>
				<strong class="text-foreground tabular-nums">{item.homeScore} – {item.awayScore}</strong>
			{/if}
			<span class="text-muted-foreground">·</span>
			{#if item.noBets}
				<span>No bets — refunded</span>
			{:else if item.push}
				<span>Push — refunded</span>
			{:else}
				<span>{item.winningSide === 'home' ? item.homeAbbr : item.awayAbbr} won</span>
			{/if}
		</span>
	{/if}
{/snippet}

<BetCard
	{icon}
	{iconImg}
	{label}
	{tone}
	{title}
	comment={item.type === 'badge_earned'
		? tierBugComment
		: item.type === 'sports_settled'
			? sportsComment
			: comment}
	date={item.at}
	{locale}
	{href}
	people={item.people}
/>
