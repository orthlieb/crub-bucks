<script lang="ts" module>
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import type { Snippet } from 'svelte';
	export type DialogContentProps = DialogPrimitive.ContentProps & {
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';
	import X from '@lucide/svelte/icons/x';
	import DialogOverlay from './dialog-overlay.svelte';

	let { class: className, children, ...rest }: DialogContentProps = $props();
</script>

<DialogPrimitive.Portal>
	<DialogOverlay />
	<DialogPrimitive.Content
		class={cn(
			'fixed left-1/2 top-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 ' +
				'-translate-y-1/2 gap-4 rounded-lg border bg-background p-6 shadow-lg ' +
				'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 ' +
				'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
			className
		)}
		{...rest}
	>
		{@render children?.()}
		<DialogPrimitive.Close
			class="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
		>
			<X class="h-4 w-4" />
			<span class="sr-only">Close</span>
		</DialogPrimitive.Close>
	</DialogPrimitive.Content>
</DialogPrimitive.Portal>
