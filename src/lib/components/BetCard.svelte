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
	import type { Snippet } from 'svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { cn } from '$lib/utils';

	type Person = { id: string; name: string; avatarUpdatedAt: Date | string | null };

	let {
		icon = null,
		label,
		tone,
		people = [],
		href,
		class: className,
		children
	}: {
		icon?: string | null;
		label: string;
		tone: BetTone;
		people?: Person[];
		/** When set, the whole card is a link. */
		href?: string;
		class?: string;
		children: Snippet;
	} = $props();

	const t = $derived(TONES[tone]);

	const shell = $derived(
		cn(
			'flex items-stretch overflow-hidden rounded-lg border bg-card shadow-sm',
			href && 'transition-colors hover:bg-accent',
			className
		)
	);
</script>

{#snippet inner()}
	<!-- State column: full card height, tinted; emoji centred, label at the bottom. -->
	<div class={cn('flex w-16 shrink-0 flex-col sm:w-20', t.box)}>
		<div class="flex flex-1 items-center justify-center pt-2 text-3xl leading-none sm:text-4xl">
			{icon ?? '💰'}
		</div>
		<div class={cn('pb-2 text-center text-[10px] font-semibold uppercase tracking-wide', t.text)}>
			{label}
		</div>
	</div>

	<!-- Text + participants, vertically centred. -->
	<div class="flex min-w-0 flex-1 items-center justify-between gap-3 p-4">
		<div class="min-w-0 flex-1 break-words text-sm leading-relaxed">
			{@render children()}
		</div>
		{#if people.length > 0}
			<div class="flex max-w-[45%] flex-wrap justify-end gap-1">
				{#each people as p (p.id)}
					<Avatar id={p.id} name={p.name} avatarUpdatedAt={p.avatarUpdatedAt} size={24} />
				{/each}
			</div>
		{/if}
	</div>
{/snippet}

{#if href}
	<a {href} class={shell}>{@render inner()}</a>
{:else}
	<div class={shell}>{@render inner()}</div>
{/if}
