<script lang="ts">
	import { updated } from '$app/state';
	import { Button } from '$lib/components/ui/button';

	// "A new version is available" banner. SvelteKit's `updated` store flips to
	// true once the client's polling (kit.version.pollInterval) sees a newer
	// deployed build. Reloading fetches the fresh app shell + assets, which also
	// avoids the stale-chunk 404s that otherwise bite on the next navigation.
	let dismissed = $state(false);
	// Show again if a newer build lands after a dismiss.
	const show = $derived(updated.current && !dismissed);

	function refresh() {
		location.reload();
	}
</script>

{#if show}
	<div
		role="status"
		class="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
	>
		<div
			class="flex w-full max-w-md items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm shadow-lg"
		>
			<div class="min-w-0 flex-1">
				<div class="font-medium">A new version is available</div>
				<div class="text-xs text-muted-foreground">Refresh to get the latest Crub Bucks.</div>
			</div>
			<Button size="sm" onclick={refresh}>Refresh</Button>
			<button
				type="button"
				aria-label="Dismiss"
				class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
				onclick={() => (dismissed = true)}
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 20 20"
					fill="currentColor"
					class="h-4 w-4"
					aria-hidden="true"
				>
					<path
						fill-rule="evenodd"
						d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 01-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		</div>
	</div>
{/if}
