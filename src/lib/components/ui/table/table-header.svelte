<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export type TableHeaderProps = HTMLAttributes<HTMLTableSectionElement> & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, children, ...rest }: TableHeaderProps = $props();
</script>

<thead class={cn('[&_tr]:border-b', className)} {...rest}>
	{@render children?.()}
</thead>
