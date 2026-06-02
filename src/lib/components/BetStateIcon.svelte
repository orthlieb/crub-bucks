<script lang="ts" module>
	export type BetTone = 'amber' | 'blue' | 'red' | 'green' | 'violet';

	// Light tint of the state colour + matching label colour.
	const TONES: Record<BetTone, { box: string; text: string }> = {
		amber: { box: 'bg-amber-400/15', text: 'text-amber-700 dark:text-amber-300' },
		blue: { box: 'bg-blue-500/15', text: 'text-blue-700 dark:text-blue-300' },
		red: { box: 'bg-destructive/10', text: 'text-destructive' },
		green: { box: 'bg-success/10', text: 'text-success' },
		violet: { box: 'bg-primary/10', text: 'text-primary' }
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		icon = null,
		label,
		tone,
		class: className
	}: { icon?: string | null; label: string; tone: BetTone; class?: string } = $props();

	const t = $derived(TONES[tone]);
</script>

<!-- Emoji box with the state label at the bottom, tinted by state. -->
<div class={cn('flex w-16 shrink-0 flex-col overflow-hidden rounded-md sm:w-20', t.box, className)}>
	<div class="flex flex-1 items-center justify-center pt-2 text-3xl leading-none sm:text-4xl">
		{icon ?? '💰'}
	</div>
	<div class={cn('py-1 text-center text-[10px] font-semibold uppercase tracking-wide', t.text)}>
		{label}
	</div>
</div>
