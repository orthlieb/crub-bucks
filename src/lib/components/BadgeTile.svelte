<script lang="ts">
	import {
		BADGES_BY_KEY,
		badgeIcon,
		badgeSilhouette,
		howToEarn,
		nextTier,
		tiersOf,
		TIER_COLOR,
		TIER_LABEL,
		TIER_EMOJI,
		METRIC_UNIT,
		type BadgeTier,
		type MetricKey
	} from '$lib/badges';
	import { tooltip } from '$lib/actions/tooltip';
	import { cn } from '$lib/utils';

	type BadgeView = {
		key: string;
		title: string;
		description: string;
		emoji: string;
		metric: MetricKey;
		thresholds: Partial<Record<BadgeTier, number>>;
		value: number;
		earnedTier: BadgeTier | null;
		earnedAt: Date | string | null;
	};

	let { badge }: { badge: BadgeView } = $props();

	const def = $derived(BADGES_BY_KEY.get(badge.key));
	const firstTier: BadgeTier = $derived(def ? (tiersOf(def)[0] ?? 'bronze') : 'bronze');
	// When locked, tint the silver art (more neutral than bronze → the purple
	// tint reads cleaner); fall back to the first tier for single-tier badges.
	const lockedBaseTier: BadgeTier = $derived(
		badge.thresholds.silver !== undefined ? 'silver' : firstTier
	);
	const displayTier: BadgeTier = $derived(badge.earnedTier ?? lockedBaseTier);
	const next = $derived(def ? nextTier(def, badge.earnedTier) : null);
	const nextThreshold = $derived(next ? (badge.thresholds[next] ?? null) : null);
	const howTo = $derived(def ? howToEarn(def) : '');

	// Art resolution: prefer the single tintable silhouette (<slug>.svg), fall
	// back to per-tier PNGs, then to the emoji.
	const svgUrl = $derived(badgeSilhouette(badge.key));
	const pngUrl = $derived(badgeIcon(badge.key, displayTier));
	let svgFailed = $state(false);
	let pngFailed = $state(false);

	const locked = $derived(!badge.earnedTier);
	// Locked badges keep the artwork visible (not a flat silhouette) but cast a
	// light *purple* tint — distinct from the silver tier's neutral gray.
	// grayscale → neutralise, then sepia+hue-rotate re-tint toward brand violet.
	const LOCKED_FILTER =
		'grayscale(1) contrast(0.38) brightness(1.55) sepia(0.5) hue-rotate(232deg) saturate(1.5)';
	// Light-purple fill for silhouette (SVG) art when locked.
	const lockedSvgFill = 'color-mix(in oklch, var(--primary) 45%, white 38%)';

	function fmtDate(d: Date | string | null): string {
		if (!d) return '';
		return new Date(d).toLocaleDateString(undefined, { dateStyle: 'medium' });
	}
</script>

<!-- Hidden probes so a missing asset cleanly falls through to the next option. -->
<img src={svgUrl} alt="" class="hidden" onerror={() => (svgFailed = true)} />
{#if svgFailed}
	<img src={pngUrl} alt="" class="hidden" onerror={() => (pngFailed = true)} />
{/if}

<div
	class={cn(
		'flex h-full flex-col items-center rounded-lg border bg-card p-4 text-center shadow-sm',
		locked && 'opacity-95'
	)}
	use:tooltip={howTo}
>
	{#if !svgFailed}
		<!-- SVG silhouette: tier colour when earned, light purple when locked. -->
		<span
			class={cn('block h-24 w-24', locked && 'opacity-80')}
			style={`background-color:${locked ? lockedSvgFill : TIER_COLOR[displayTier]};-webkit-mask:url(${svgUrl}) center/contain no-repeat;mask:url(${svgUrl}) center/contain no-repeat;`}
			role="img"
			aria-label={badge.title}
		></span>
	{:else if !pngFailed}
		<!-- PNG art: full colour when earned, light purple tint when locked. -->
		<img
			src={pngUrl}
			alt={badge.title}
			class="h-24 w-24 object-contain"
			style={locked ? `filter:${LOCKED_FILTER};opacity:0.75` : ''}
		/>
	{:else}
		<div
			class="flex h-24 w-24 items-center justify-center text-5xl select-none"
			style={locked ? `filter:${LOCKED_FILTER};opacity:0.75` : ''}
		>
			{badge.emoji}
		</div>
	{/if}

	<div class="mt-2 font-semibold leading-tight">{badge.title}</div>

	{#if badge.earnedTier}
		<div class="mt-1 text-sm font-medium">
			{TIER_EMOJI[badge.earnedTier]}
			{TIER_LABEL[badge.earnedTier]}
		</div>
		<div class="text-xs text-muted-foreground">earned {fmtDate(badge.earnedAt)}</div>
	{:else}
		<div class="mt-1 text-sm text-muted-foreground">Locked</div>
	{/if}

	<p class="mt-2 text-xs text-muted-foreground">{badge.description}</p>

	<!-- Progress floats to the bottom so bars line up across the grid. -->
	<div class="mt-auto w-full pt-3">
		{#if next && nextThreshold !== null}
			{@const pct = Math.min(100, Math.round((badge.value / nextThreshold) * 100))}
			<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full rounded-full bg-primary" style={`width:${pct}%`}></div>
			</div>
			<div class="mt-1 text-[11px] text-muted-foreground">
				{badge.value} / {nextThreshold}
				{METRIC_UNIT[badge.metric]} → {TIER_LABEL[next]}
			</div>
		{:else if badge.earnedTier}
			<div class="text-[11px] font-medium text-primary">Maxed out 🎉</div>
		{/if}
	</div>
</div>
