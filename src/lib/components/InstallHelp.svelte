<script lang="ts">
	import { Card, CardContent } from '$lib/components/ui/card';
	import { installState } from '$lib/install.svelte';
	import InstallSteps from '$lib/components/InstallSteps.svelte';

	// Hidden once the app is already installed — the steps would be redundant.
	const install = installState();
</script>

{#if !install.installed}
	<Card>
		<CardContent class="space-y-3 py-4">
			<h2 class="text-sm font-semibold">Install Crub Bucks on your phone</h2>
			<p class="text-sm text-muted-foreground">
				Add it to your home screen for a full-screen, app-like experience — no app store needed.
			</p>
			<InstallSteps />
		</CardContent>
	</Card>
{/if}
