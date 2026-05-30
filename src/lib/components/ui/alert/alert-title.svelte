<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type AlertTitleProps = HTMLAttributes<HTMLHeadingElement> & {
		class?: string;
		level?: 5 | 6;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, level = 5, children, ...rest }: AlertTitleProps = $props();
</script>

{#if level === 5}
	<h5 class={cn('mb-1 font-medium leading-none tracking-tight', className)} {...rest}>
		{@render children?.()}
	</h5>
{:else}
	<h6 class={cn('mb-1 font-medium leading-none tracking-tight', className)} {...rest}>
		{@render children?.()}
	</h6>
{/if}
