<script lang="ts" module>
	import { Dialog as DialogPrimitive } from 'bits-ui';
	export type DialogDescriptionProps = DialogPrimitive.DescriptionProps;
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, ...rest }: DialogDescriptionProps = $props();
</script>

<DialogPrimitive.Description class={cn('text-sm text-muted-foreground', className)} {...rest} />
