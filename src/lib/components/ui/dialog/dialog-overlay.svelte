<script lang="ts" module>
	import { Dialog as DialogPrimitive } from 'bits-ui';
	export type DialogOverlayProps = DialogPrimitive.OverlayProps;
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, ...rest }: DialogOverlayProps = $props();
</script>

<DialogPrimitive.Overlay
	class={cn(
		'fixed inset-0 z-50 bg-black/60 backdrop-blur-sm ' +
			'data-[state=open]:animate-in data-[state=open]:fade-in-0 ' +
			'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
		className
	)}
	{...rest}
/>
