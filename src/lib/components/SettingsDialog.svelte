<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import SoundToggle from '$lib/components/SoundToggle.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { resizeToSquare } from '$lib/avatar-client';

	let {
		user
	}: {
		user: { id: string; displayName: string; role: string; avatarUpdatedAt: Date | string | null };
	} = $props();

	let fileInput: HTMLInputElement;
	let busy = $state(false);
	let errorMsg = $state('');

	async function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-picking the same file later
		if (!file) return;
		if (!file.type.startsWith('image/')) {
			errorMsg = 'Please choose an image file.';
			return;
		}
		busy = true;
		errorMsg = '';
		try {
			const blob = await resizeToSquare(file, 512);
			const res = await fetch('/app/avatar', {
				method: 'POST',
				headers: { 'content-type': blob.type || 'image/webp' },
				body: blob
			});
			if (!res.ok) throw new Error(`Upload failed (${res.status})`);
			await invalidateAll(); // refresh avatarUpdatedAt across the app
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Upload failed.';
		} finally {
			busy = false;
		}
	}

	async function removePhoto() {
		busy = true;
		errorMsg = '';
		try {
			const res = await fetch('/app/avatar', { method: 'DELETE' });
			if (!res.ok) throw new Error(`Couldn't remove photo (${res.status})`);
			await invalidateAll();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not remove photo.';
		} finally {
			busy = false;
		}
	}
</script>

<Dialog.Root>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="rounded-full ring-offset-background transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
				aria-label="Settings"
				title="Settings"
			>
				<Avatar id={user.id} name={user.displayName} avatarUpdatedAt={user.avatarUpdatedAt} size={32} />
			</button>
		{/snippet}
	</Dialog.Trigger>

	<Dialog.Content class="max-w-sm">
		<Dialog.Title>Settings</Dialog.Title>
		<Dialog.Description>Signed in as {user.displayName}</Dialog.Description>

		<!-- Profile photo -->
		<div class="flex items-center gap-4">
			<Avatar id={user.id} name={user.displayName} avatarUpdatedAt={user.avatarUpdatedAt} size={56} />
			<div class="flex flex-col gap-2">
				<div class="flex gap-2">
					<Button variant="outline" size="sm" disabled={busy} onclick={() => fileInput.click()}>
						{user.avatarUpdatedAt ? 'Change photo' : 'Upload photo'}
					</Button>
					{#if user.avatarUpdatedAt}
						<Button variant="ghost" size="sm" disabled={busy} onclick={removePhoto}>Remove</Button>
					{/if}
				</div>
				<p class="text-xs text-muted-foreground">Square, downsized to 512px. Max 512&nbsp;KB.</p>
			</div>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				class="hidden"
				onchange={onPick}
			/>
		</div>
		{#if errorMsg}
			<p class="text-sm text-destructive">{errorMsg}</p>
		{/if}

		<div class="divide-y border-t">
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
