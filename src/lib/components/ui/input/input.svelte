<script lang="ts" module>
	import type { HTMLInputAttributes } from 'svelte/elements';

	export type InputProps = HTMLInputAttributes & {
		class?: string;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		value = $bindable(),
		type = 'text',
		...rest
	}: InputProps = $props();
</script>

<input
	{type}
	bind:value
	class={cn(
		'flex h-9 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-1 text-sm text-foreground shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none',
		className
	)}
	{...rest}
/>
