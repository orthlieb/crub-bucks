<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type CardHeaderProps = HTMLAttributes<HTMLDivElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: CardHeaderProps = $props();
</script>

<div class={cn('flex flex-col space-y-1.5 p-6', className)} {...rest}>
	{@render children?.()}
</div>
