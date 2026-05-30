<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';

	export const alertVariants = tv({
		base: 'relative w-full rounded-lg border px-4 py-3 text-sm [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground [&>svg~*]:pl-7',
		variants: {
			variant: {
				default: 'bg-background text-foreground',
				destructive:
					'border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive',
				success:
					'border-success/40 text-success bg-success/5 [&>svg]:text-success',
				info: 'border-primary/30 text-foreground bg-primary/5',
				warning:
					'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/5 [&>svg]:text-amber-600'
			}
		},
		defaultVariants: { variant: 'default' }
	});

	export type AlertVariant = VariantProps<typeof alertVariants>['variant'];

	export type AlertProps = HTMLAttributes<HTMLDivElement> & {
		variant?: AlertVariant;
		class?: string;
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let { class: className, variant = 'default', children, ...rest }: AlertProps = $props();
</script>

<div role="alert" class={cn(alertVariants({ variant }), className)} {...rest}>
	{@render children?.()}
</div>
