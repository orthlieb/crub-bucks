<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type CardTitleProps = HTMLAttributes<HTMLHeadingElement> & {
		class?: string;
		level?: 1 | 2 | 3 | 4 | 5 | 6;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, level = 3, children, ...rest }: CardTitleProps = $props();
	const cls = $derived(cn('text-lg font-semibold leading-none tracking-tight', className));
</script>

<svelte:element this={`h${level}`} class={cls} {...rest}>
	{@render children?.()}
</svelte:element>
