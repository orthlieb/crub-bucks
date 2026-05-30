<script lang="ts" module>
	import type { HTMLThAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type TableHeadProps = HTMLThAttributes & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: TableHeadProps = $props();
</script>

<th
	class={cn(
		'h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
		className
	)}
	{...rest}
>
	{@render children?.()}
</th>
