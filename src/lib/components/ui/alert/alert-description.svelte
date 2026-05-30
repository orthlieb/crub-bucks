<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type AlertDescriptionProps = HTMLAttributes<HTMLDivElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: AlertDescriptionProps = $props();
</script>

<div class={cn('text-sm [&_p]:leading-relaxed', className)} {...rest}>
	{@render children?.()}
</div>
