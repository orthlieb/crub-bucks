<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type CardFooterProps = HTMLAttributes<HTMLDivElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: CardFooterProps = $props();
</script>

<div class={cn('flex items-center p-6 pt-0', className)} {...rest}>
	{@render children?.()}
</div>
