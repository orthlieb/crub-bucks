<script lang="ts">
	import {
		BADGES_BY_KEY,
		badgeIcon,
		badgeSilhouette,
		nextTier,
		tiersOf,
		TIER_COLOR,
		TIER_LABEL,
		TIER_EMOJI,
		METRIC_UNIT,
		type BadgeTier,
		type MetricKey
	} from '$lib/badges';
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
	const displayTier: BadgeTier = $derived(badge.earnedTier ?? firstTier);
	const next = $derived(def ? nextTier(def, badge.earnedTier) : null);
	const nextThreshold = $derived(next ? (badge.thresholds[next] ?? null) : null);

	// Art resolution: prefer the single tintable silhouette (<slug>.svg), fall
	// back to per-tier PNGs, then to the emoji — so nothing breaks while art is
	// still being made.
	const svgUrl = $derived(badgeSilhouette(badge.key));
	const pngUrl = $derived(badgeIcon(badge.key, displayTier));
	let svgFailed = $state(false);
	let pngFailed = $state(false);

	// Earned → tier color; locked → muted "ghost" fill (also dimmed via opacity).
	const fill = $derived(badge.earnedTier ? TIER_COLOR[badge.earnedTier] : 'var(--muted-foreground)');
	const locked = $derived(!badge.earnedTier);

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
		'flex flex-col items-center rounded-lg border bg-card p-4 text-center shadow-sm',
		locked && 'opacity-95'
	)}
>
	{#if !svgFailed}
		<!-- One image, tinted: silhouette masked, filled with the tier/ghost color. -->
		<span
			class={cn('block h-24 w-24', locked && 'opacity-40')}
			style={`background-color:${fill};-webkit-mask:url(${svgUrl}) center/contain no-repeat;mask:url(${svgUrl}) center/contain no-repeat;`}
			role="img"
			aria-label={badge.title}
		></span>
	{:else if !pngFailed}
		<img
			src={pngUrl}
			alt={badge.title}
			class={cn('h-24 w-24 object-contain', locked && 'opacity-40 grayscale')}
		/>
	{:else}
		<div
			class={cn('flex h-24 w-24 items-center justify-center text-5xl select-none', locked && 'opacity-40 grayscale')}
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

	{#if next && nextThreshold !== null}
		{@const pct = Math.min(100, Math.round((badge.value / nextThreshold) * 100))}
		<div class="mt-3 w-full">
			<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
				<div class="h-full rounded-full bg-primary" style={`width:${pct}%`}></div>
			</div>
			<div class="mt-1 text-[11px] text-muted-foreground">
				{badge.value} / {nextThreshold}
				{METRIC_UNIT[badge.metric]} → {TIER_LABEL[next]}
			</div>
		</div>
	{:else if badge.earnedTier}
		<div class="mt-3 text-[11px] font-medium text-primary">Maxed out 🎉</div>
	{/if}
</div>
