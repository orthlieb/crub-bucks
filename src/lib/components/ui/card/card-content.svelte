<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type CardContentProps = HTMLAttributes<HTMLDivElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: CardContentProps = $props();
</script>

<div class={cn('p-6 pt-0', className)} {...rest}>
	{@render children?.()}
</div>
