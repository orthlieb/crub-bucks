<script lang="ts" module>
	import type { HTMLAttributes } from 'svelte/elements';

	export type SeparatorProps = HTMLAttributes<HTMLDivElement> & {
		class?: string;
		orientation?: 'horizontal' | 'vertical';
		decorative?: boolean;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		orientation = 'horizontal',
		decorative = true,
		...rest
	}: SeparatorProps = $props();
</script>

<div
	role={decorative ? 'none' : 'separator'}
	aria-orientation={orientation}
	class={cn(
		'shrink-0 bg-border',
		orientation === 'horizontal' ? 'h-[1px] w-full' : 'h-full w-[1px]',
		className
	)}
	{...rest}
></div>
