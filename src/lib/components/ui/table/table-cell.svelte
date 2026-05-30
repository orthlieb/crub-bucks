<script lang="ts" module>
	import type { HTMLTdAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type TableCellProps = HTMLTdAttributes & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: TableCellProps = $props();
</script>

<td
	class={cn(
		'p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
		className
	)}
	{...rest}
>
	{@render children?.()}
</td>
