<script lang="ts">
	import type { BetMode } from '$lib/ledger-math';
	import Scale from '@lucide/svelte/icons/scale';
	import Trophy from '@lucide/svelte/icons/trophy';
	import ChartColumnIncreasing from '@lucide/svelte/icons/chart-column-increasing';
	import Coins from '@lucide/svelte/icons/coins';
	import Wrench from '@lucide/svelte/icons/wrench';
	import Dices from '@lucide/svelte/icons/dices';

	let {
		mode,
		size = 16,
		class: className = ''
	}: { mode: BetMode; size?: number; class?: string } = $props();

	// even = scales, winner/loser = trophy, tiered = ascending bars (stairs-ish),
	// pot = coins, custom = wrench, odds = dice. Swap in custom SVGs here later.
	const icons = {
		even_split: Scale,
		winner_loser: Trophy,
		tiered: ChartColumnIncreasing,
		pot: Coins,
		custom: Wrench,
		odds: Dices
	} as const;

	const Icon = $derived(icons[mode]);
</script>

<Icon {size} class={className} aria-hidden="true" />
