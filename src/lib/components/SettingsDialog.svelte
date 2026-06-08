<script lang="ts">
	import { onDestroy } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import SoundToggle from '$lib/components/SoundToggle.svelte';
	import NotificationToggle from '$lib/components/NotificationToggle.svelte';
	import Avatar from '$lib/components/Avatar.svelte';
	import { resizeToSquare } from '$lib/avatar-client';

	let {
		user
	}: {
		user: {
			id: string;
			displayName: string;
			role: string;
			avatarUpdatedAt: Date | string | null;
			avatarIcon: string | null;
		};
	} = $props();

	let fileInput: HTMLInputElement;
	let busy = $state(false);
	let errorMsg = $state('');

	// True when the user has any custom avatar (photo or emoji) to remove.
	const hasCustomAvatar = $derived(!!user.avatarUpdatedAt || !!user.avatarIcon);

	// --- Display name editing ------------------------------------------------
	// Populated from the current name whenever the dialog opens (onOpenChange).
	let name = $state('');
	let nameSaved = $state(false);
	let nameError = $state(false); // true when the last name save failed (red field)
	const canSaveName = $derived(name.trim().length >= 2 && name.trim() !== user.displayName);

	// Reset the field to the current name each time the dialog opens.
	function onOpenChange(isOpen: boolean) {
		if (isOpen) {
			name = user.displayName;
			errorMsg = '';
			nameError = false;
			nameSaved = false;
			iconPickerOpen = false;
		}
	}

	async function saveName() {
		const next = name.trim().replace(/\s+/g, ' ');
		if (next === user.displayName || next.length < 2) return;
		busy = true;
		errorMsg = '';
		nameError = false;
		nameSaved = false;
		try {
			const res = await fetch('/app/profile', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ displayName: next })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.message ?? `Couldn't save (${res.status})`);
			}
			name = next;
			nameSaved = true;
			await invalidateAll(); // refresh the name across the app (header, feed, …)
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not save name.';
			nameError = true;
		} finally {
			busy = false;
		}
	}

	async function onPick(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = ''; // allow re-picking the same file later
		nameError = false; // any error from here is an avatar error, not the name
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

	async function removeAvatar() {
		busy = true;
		errorMsg = '';
		nameError = false;
		try {
			const res = await fetch('/app/avatar', { method: 'DELETE' });
			if (!res.ok) throw new Error(`Couldn't remove avatar (${res.status})`);
			await invalidateAll();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not remove avatar.';
		} finally {
			busy = false;
		}
	}

	// --- Emoji icon picker ---------------------------------------------------
	// emoji-picker-element is a self-registering web component; import it lazily
	// after mount so its ~75 KB of code + data stays out of the SSR bundle and
	// only loads when the settings dialog is used. Mirrors the bet/payment
	// pickers. The picker is created once and visibility-toggled.
	let iconPickerOpen = $state(false);
	let pickerMount = $state<HTMLDivElement | undefined>();
	let pickerInstance: HTMLElement | null = null;
	let themeObserver: MutationObserver | null = null;

	async function chooseIcon(emoji: string) {
		iconPickerOpen = false;
		busy = true;
		errorMsg = '';
		nameError = false;
		try {
			const res = await fetch('/app/avatar', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ icon: emoji })
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.message ?? `Couldn't set icon (${res.status})`);
			}
			await invalidateAll(); // refresh avatarIcon across the app
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not set icon.';
		} finally {
			busy = false;
		}
	}

	function applyPickerTheme() {
		if (!pickerInstance) return;
		const dark = document.documentElement.classList.contains('dark');
		pickerInstance.classList.toggle('dark', dark);
		pickerInstance.classList.toggle('light', !dark);
	}

	// Build the picker lazily on first open (the dialog — and its mount point —
	// only exist while open, and we don't want emoji-picker-element's ~75 KB
	// loading on every app page just because the header hosts this dialog).
	// The dialog content is recreated each open, so rebuild if disconnected.
	async function ensurePicker() {
		if (!pickerMount || (pickerInstance && pickerInstance.isConnected)) return;
		const { Picker } = await import('emoji-picker-element');
		if (!pickerMount) return;
		const p = new Picker() as HTMLElement;
		p.addEventListener('emoji-click', (e: Event) => {
			const detail = (e as CustomEvent<{ unicode: string }>).detail;
			if (detail?.unicode) chooseIcon(detail.unicode);
		});
		p.style.setProperty('--num-columns', '8');
		p.style.width = '100%';
		pickerMount.replaceChildren(p);
		pickerInstance = p;
		applyPickerTheme();
		if (!themeObserver) {
			themeObserver = new MutationObserver(applyPickerTheme);
			themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['class']
			});
		}
	}

	function toggleIconPicker() {
		iconPickerOpen = !iconPickerOpen;
		if (iconPickerOpen) ensurePicker();
	}

	onDestroy(() => {
		themeObserver?.disconnect();
		themeObserver = null;
	});
</script>

<Dialog.Root {onOpenChange}>
	<Dialog.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="rounded-full ring-offset-background transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
				aria-label="Settings"
				title="Settings"
			>
				<Avatar
					id={user.id}
					name={user.displayName}
					avatarUpdatedAt={user.avatarUpdatedAt}
					avatarIcon={user.avatarIcon}
					size={32}
				/>
			</button>
		{/snippet}
	</Dialog.Trigger>

	<Dialog.Content class="max-w-sm">
		<Dialog.Title>Settings</Dialog.Title>
		<Dialog.Description>Signed in as {user.displayName}</Dialog.Description>

		<!-- Profile picture: a photo OR an emoji icon -->
		<div class="flex flex-col gap-3">
			<div class="flex items-center gap-4">
				<Avatar
					id={user.id}
					name={user.displayName}
					avatarUpdatedAt={user.avatarUpdatedAt}
					avatarIcon={user.avatarIcon}
					size={56}
				/>
				<div class="flex flex-col gap-2">
					<div class="flex flex-wrap gap-2">
						<Button variant="outline" size="sm" disabled={busy} onclick={() => fileInput.click()}>
							{user.avatarUpdatedAt ? 'Change photo' : 'Upload photo'}
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={busy}
							aria-expanded={iconPickerOpen}
							onclick={toggleIconPicker}
						>
							{user.avatarIcon ? 'Change icon' : 'Choose icon'}
						</Button>
						{#if hasCustomAvatar}
							<Button variant="ghost" size="sm" disabled={busy} onclick={removeAvatar}>Remove</Button>
						{/if}
					</div>
					<p class="text-xs text-muted-foreground">
						Photo: square, downsized to 512px, max 512&nbsp;KB. Or pick an emoji.
					</p>
				</div>
			</div>

			<!-- Emoji picker popover (the picker element is appended on mount). -->
			<div class={iconPickerOpen ? 'block' : 'hidden'}>
				<div bind:this={pickerMount} class="overflow-hidden rounded-md border"></div>
			</div>

			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				class="hidden"
				onchange={onPick}
			/>
		</div>
		<!-- Display name -->
		<div class="space-y-2 border-t pt-3">
			<label for="display-name" class="text-sm font-medium">Display name</label>
			<div class="flex gap-2">
				<Input
					id="display-name"
					bind:value={name}
					maxlength={40}
					disabled={busy}
					class="flex-1"
					autocomplete="off"
					aria-invalid={nameError}
					onkeydown={(e: KeyboardEvent) => {
						if (e.key === 'Enter' && canSaveName) {
							e.preventDefault();
							saveName();
						}
					}}
				/>
				<Button size="sm" disabled={busy || !canSaveName} onclick={saveName}>Save</Button>
			</div>
			{#if nameSaved}<p class="text-xs text-success">Saved.</p>{/if}
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
					<div class="text-sm font-medium">Sound effects</div>
					<div class="text-xs text-muted-foreground">Cues for gains, losses, bets, and friend requests.</div>
				</div>
				<SoundToggle />
			</div>

			<div class="flex items-center justify-between py-3">
				<div>
					<div class="text-sm font-medium">Notifications</div>
					<div class="text-xs text-muted-foreground">Push alerts for bets, payments, friends, and awards.</div>
				</div>
				<NotificationToggle />
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
