<script lang="ts">
	import type { PageData } from './$types';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';

	let { data }: { data: PageData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background py-16 px-4">
	<div class="mx-auto max-w-md text-center">
		<a href="/" class="mb-8 inline-flex items-center gap-2 font-semibold tracking-tight">
			<span
				class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm"
				>₡</span
			>
			<span>Crub Bucks</span>
		</a>

		<Card class="text-left">
			<CardHeader>
				<CardTitle level={1}>We'll be right back</CardTitle>
				<CardDescription>
					Crub Bucks is in maintenance mode. Please check back shortly.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if data.message}
					<Alert>
						<AlertDescription>{data.message}</AlertDescription>
					</Alert>
				{/if}
				{#if !data.active}
					<div class="mt-4">
						<Button href="/">Maintenance is over — go to the app</Button>
					</div>
				{/if}
			</CardContent>
		</Card>
	</div>
</div>
