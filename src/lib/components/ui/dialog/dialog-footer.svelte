<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	export type DialogFooterProps = HTMLAttributes<HTMLDivElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: DialogFooterProps = $props();
</script>

<div class={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...rest}>
	{@render children?.()}
</div>
