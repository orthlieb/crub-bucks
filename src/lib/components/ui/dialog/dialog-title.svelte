<script lang="ts" module>
	import { Dialog as DialogPrimitive } from 'bits-ui';
	export type DialogTitleProps = DialogPrimitive.TitleProps;
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, ...rest }: DialogTitleProps = $props();
</script>

<DialogPrimitive.Title
	class={cn('text-lg font-semibold leading-none tracking-tight', className)}
	{...rest}
/>
