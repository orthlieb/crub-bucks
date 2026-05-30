<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	// svelte-check's <caption> typing trips on element-specific overloads;
	// HTMLAttributes<HTMLElement> is the friendliest superset that still
	// accepts the standard class/style/aria/data-*/on:* props.
	export type TableCaptionProps = HTMLAttributes<HTMLElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: TableCaptionProps = $props();
</script>

<caption class={cn('mt-4 text-sm text-muted-foreground', className)} {...rest}>
	{@render children?.()}
</caption>
