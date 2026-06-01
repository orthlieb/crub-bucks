<script lang="ts">
	import Settings from '@lucide/svelte/icons/settings';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import SoundToggle from '$lib/components/SoundToggle.svelte';

	let { user }: { user: { displayName: string; role: string } } = $props();
</script>

<Dialog.Root>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<Button {...props} variant="ghost" size="icon" aria-label="Settings" title="Settings">
				<Settings />
			</Button>
		{/snippet}
	</Dialog.Trigger>

	<Dialog.Content class="max-w-sm">
		<Dialog.Title>Settings</Dialog.Title>
		<Dialog.Description>Signed in as {user.displayName}</Dialog.Description>

		<div class="divide-y">
			<div class="flex items-center justify-between py-3">
				<div>
					<div class="text-sm font-medium">Theme</div>
					<div class="text-xs text-muted-foreground">Light, dark, or follow your system.</div>
				</div>
				<ThemeToggle />
			</div>

			<div class="flex items-center justify-between py-3">
				<div>
					<div class="text-sm font-medium">Cha-ching sound</div>
					<div class="text-xs text-muted-foreground">Play a sound when someone pays you.</div>
				</div>
				<SoundToggle />
			</div>
		</div>

		<Dialog.Footer>
			{#if user.role === 'admin'}
				<Button variant="outline" href="/admin">Admin</Button>
			{/if}
			<form method="POST" action="/logout" class="contents">
				<Button variant="ghost" type="submit">Log out</Button>
			</form>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
