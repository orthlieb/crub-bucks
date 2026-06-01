<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';

	const status = $derived(page.status);
	const message = $derived(page.error?.message ?? 'Something went sideways.');

	// A line that fits the error code, with a fallback for anything else.
	const lines: Record<number, string> = {
		404: "Cala can't find that page.",
		403: "Cala says you're not on the list.",
		500: 'Cala broke something. We are looking into it.'
	};
	const headline = $derived(lines[status] ?? "Something's off.");
</script>

<div class="kibble-bg flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
	<img
		src="/cala-confused.png"
		alt="Cala the dog tilting her head with a question mark above her — confused."
		width="260"
		height="260"
		class="h-48 w-auto select-none"
	/>
	<p class="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
		Error {status}
	</p>
	<h1 class="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{headline}</h1>
	<p class="mt-3 max-w-md text-muted-foreground">{message}</p>
	<div class="mt-6 flex flex-wrap justify-center gap-3">
		<Button href="/app">Back to your bets</Button>
		<Button variant="outline" href="/">Home</Button>
	</div>
</div>
