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
	import Avatar, { type AvatarRing } from '$lib/components/Avatar.svelte';
	import { formatAmount } from '$lib/format';
	import { cn } from '$lib/utils';

	type Person = {
		id: string;
		name: string;
		avatarUpdatedAt: Date | string | null;
		avatarIcon?: string | null;
		ring?: AvatarRing;
	};

	let {
		icon = null,
		iconImg = null,
		label,
		tone,
		title,
		amount = null,
		comment = null,
		date,
		locale,
		people = [],
		href,
		class: className
	}: {
		icon?: string | null;
		/** Preferred image icon (e.g. badge art); falls back to `icon` emoji. */
		iconImg?: string | null;
		label: string;
		tone: BetTone;
		/** Headline: the bet title, or a payment's "A paid B" summary. */
		title: string;
		/** Total wagered (bets) or transferred (payments). Null hides the line. */
		amount?: number | null;
		/** Optional note on its own line: a plain string, or a snippet for rich
		 *  content (e.g. the feed's tier-bug + label). Strings stay text-safe. */
		comment?: string | Snippet | null;
		date: Date | string;
		locale?: string;
		people?: Person[];
		/** When set, the whole card is a link. */
		href?: string;
		class?: string;
	} = $props();

	const t = $derived(TONES[tone]);

	const shell = $derived(
		cn(
			'flex items-stretch overflow-hidden rounded-lg border bg-card shadow-sm',
			href && 'transition-colors hover:bg-accent',
			className
		)
	);

	// Fall back to the emoji if the image icon fails to load.
	let iconImgFailed = $state(false);

	function fmtDate(d: Date | string): string {
		const parsed = typeof d === 'string' ? new Date(d) : d;
		return parsed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}

	// Stack avatars into at most two rows, filling top-first: 2×1, then 2×2 (3–4),
	// 3×2 (5–6), 4×2 (7–8)… — columns grow, rows cap at two.
	const avatarCols = $derived(people.length <= 2 ? people.length : Math.ceil(people.length / 2));
</script>

{#snippet inner()}
	<!-- State column: full card height, tinted; emoji centred, label at the bottom. -->
	<div class={cn('flex w-20 shrink-0 flex-col sm:w-24', t.box)}>
		<div class="flex flex-1 items-center justify-center pt-2 text-3xl leading-none sm:text-4xl">
			{#if iconImg && !iconImgFailed}
				<img
					src={iconImg}
					alt=""
					class="h-9 w-9 object-contain sm:h-11 sm:w-11"
					onerror={() => (iconImgFailed = true)}
				/>
			{:else}
				{icon ?? '💰'}
			{/if}
		</div>
		<div class={cn('pb-2 text-center text-[10px] font-semibold uppercase tracking-wide', t.text)}>
			{label}
		</div>
	</div>

	<!-- Standardised body: title + amount, optional comment, date — then avatars. -->
	<div class="flex min-w-0 flex-1 items-center justify-between gap-3 p-4">
		<div class="min-w-0 flex-1 space-y-1">
			<div class="truncate text-sm font-semibold">
				{#if amount != null}<span class="tabular-nums">{formatAmount(amount, locale)} ₡</span>{' — '}{/if}{title}
			</div>
			{#if comment}
				<div class="break-words text-xs text-muted-foreground">
					{#if typeof comment === 'function'}{@render comment()}{:else}{comment}{/if}
				</div>
			{/if}
			<div class="text-xs text-muted-foreground">{fmtDate(date)}</div>
		</div>
		{#if people.length > 0}
			<div class="grid shrink-0 gap-1.5" style={`grid-template-columns:repeat(${avatarCols}, auto)`}>
				{#each people as p (p.id)}
					<Avatar
						id={p.id}
						name={p.name}
						avatarUpdatedAt={p.avatarUpdatedAt}
						avatarIcon={p.avatarIcon ?? null}
						ring={p.ring ?? null}
						size={24}
					/>
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
