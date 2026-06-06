<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import Avatar from '$lib/components/Avatar.svelte';
	import FriendCombobox from '$lib/components/FriendCombobox.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// Client-side filter over the already-loaded friends list. Case-insensitive
	// substring match on display name OR email. Friends are capped at 99 so
	// filtering in JS is trivial — no server round-trip.
	let friendFilter = $state('');
	const filteredFriends = $derived.by(() => {
		const q = friendFilter.trim().toLowerCase();
		if (!q) return data.friends;
		return data.friends.filter(
			(f) => f.displayName.toLowerCase().includes(q) || f.email.toLowerCase().includes(q)
		);
	});
	// Server returns favorites-first then alphabetical; we split the matched
	// list into two groups so we can render a "Favorites" header above the
	// pinned ones.
	const filteredFavorites = $derived(filteredFriends.filter((f) => f.isFavorite));
	const filteredOthers = $derived(filteredFriends.filter((f) => !f.isFavorite));

	// Selected friend drives the unified pay / unfriend action panel.
	// Reset to null when the underlying list refreshes (e.g. unfriend
	// succeeds) and the selected id no longer exists.
	let selectedFriendId = $state<string | null>(null);
	const selectedFriend = $derived(
		data.friends.find((f) => f.id === selectedFriendId) ?? null
	);
	$effect(() => {
		if (selectedFriendId && !selectedFriend) selectedFriendId = null;
	});

	// The Pay-a-friend selector uses the shared FriendCombobox typeahead, which
	// binds `selectedFriendId` directly (the list rows below set it too).

	// Per-friend icon memory for the pay form (so if you select a friend,
	// pick 🍕, switch to another, then come back, your 🍕 is still there).
	// Default 💸. The shared picker writes here keyed by `selectedFriendId`.
	let payIcons = $state<Record<string, string>>({});
	let pickerOpen = $state(false);
	let pickerMount: HTMLDivElement | undefined = $state();
	let pickerInstance: HTMLElement | null = null;
	let themeObserver: MutationObserver | null = null;

	function iconFor(id: string | null): string {
		return id ? (payIcons[id] ?? '💸') : '💸';
	}

	onMount(() => {
		let disposed = false;
		(async () => {
			const { Picker } = await import('emoji-picker-element');
			if (disposed || !pickerMount) return;
			const p = new Picker() as HTMLElement;

			const syncTheme = () => {
				const dark = document.documentElement.classList.contains('dark');
				p.classList.toggle('dark', dark);
				p.classList.toggle('light', !dark);
			};
			syncTheme();
			themeObserver = new MutationObserver(syncTheme);
			themeObserver.observe(document.documentElement, {
				attributes: true,
				attributeFilter: ['class']
			});

			p.addEventListener('emoji-click', (e: Event) => {
				const detail = (e as CustomEvent<{ unicode: string }>).detail;
				if (detail?.unicode && selectedFriendId) {
					payIcons = { ...payIcons, [selectedFriendId]: detail.unicode };
					pickerOpen = false;
				}
			});
			p.style.setProperty('--num-columns', '8');
			p.style.width = '100%';
			pickerMount.appendChild(p);
			pickerInstance = p;
		})();
		return () => {
			disposed = true;
			themeObserver?.disconnect();
			themeObserver = null;
			pickerInstance?.remove();
			pickerInstance = null;
		};
	});

	// Close picker on Escape or backdrop click.
	function onBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) pickerOpen = false;
	}
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && pickerOpen) pickerOpen = false;
	}
</script>

<div class="space-y-8">
	<header class="flex items-stretch gap-3">
		<div class="shrink-0 self-stretch">
			<img src="/friends.png" alt="" class="h-full w-auto object-contain" />
		</div>
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Friends</h1>
			<p class="mt-1 text-muted-foreground">Add them. Give them bones. Bark at them.</p>
		</div>
	</header>

	<!-- Pay a friend (or unfriend). Picks from the same `selectedFriendId`
	     state that row-clicks below drive, so either path works. -->
	{#if data.friends.length > 0}
		<Card class="overflow-hidden">
			<!-- Two-column layout: Cala-money on the left (hidden on small
			     screens where the image would crowd the form), header +
			     content stacked on the right. items-stretch on the flex
			     parent makes the image column match the form column's height. -->
			<div class="flex items-stretch">
				<div class="hidden w-40 shrink-0 items-center justify-center overflow-hidden border-r bg-primary/5 p-2 sm:flex lg:w-48">
					<img
						src="/cala-money.png"
						alt="Cala the dog proudly holding a 1 Crub Buck note."
						class="h-56 w-full select-none object-contain"
					/>
				</div>
				<div class="min-w-0 flex-1">
			<CardHeader>
				<CardTitle level={2}>Pay a friend</CardTitle>
				<CardDescription>
					Pick a friend, enter an amount, and send them some bucks. Tap a row in the list
					below to fill this in quickly.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.payError}
					<Alert variant="destructive" class="mb-4"><AlertDescription>{form.payError}</AlertDescription></Alert>
				{:else if form?.paid}
					<Alert variant="success" class="mb-4"><AlertDescription>Payment sent.</AlertDescription></Alert>
				{/if}

				<div class="space-y-2">
					<Label for="pay-friend-search">Friend</Label>

					{#if selectedFriend}
						<!-- Chip with current selection. Change clears + refocuses
						     the search input so the user can pick a different friend. -->
						<div class="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
							<div class="flex min-w-0 items-center gap-3">
								<Avatar
									id={selectedFriend.id}
									name={selectedFriend.displayName}
									avatarUpdatedAt={selectedFriend.avatarUpdatedAt}
									size={36}
								/>
								<div class="min-w-0">
									<div class="truncate font-medium">
										{selectedFriend.displayName}
										{#if selectedFriend.isFavorite}
											<span aria-hidden="true" class="text-yellow-500">★</span>
										{/if}
									</div>
									<div class="truncate text-xs text-muted-foreground">{selectedFriend.email}</div>
								</div>
							</div>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onclick={() => {
									selectedFriendId = null;
									queueMicrotask(() =>
										(document.getElementById('pay-friend-search') as HTMLInputElement | null)?.focus()
									);
								}}
							>
								Change
							</Button>
						</div>
					{:else}
						<FriendCombobox
							id="pay-friend-search"
							friends={data.friends}
							bind:value={selectedFriendId}
							placeholder="Start typing a name or email…"
						/>
						<p class="text-xs text-muted-foreground">
							Or tap a friend in the list below. Use ↑/↓ + Enter to pick from suggestions.
						</p>
					{/if}
				</div>

				{#if selectedFriend}
					<form
						method="POST"
						action="?/pay"
						use:enhance
						class="mt-4 flex flex-wrap items-end gap-2"
					>
						<input type="hidden" name="toUserId" value={selectedFriend.id} />
						<input type="hidden" name="icon" value={iconFor(selectedFriend.id)} />
						<div class="space-y-1">
							<Label class="text-xs">Icon</Label>
							<button
								type="button"
								onclick={() => (pickerOpen = true)}
								aria-haspopup="dialog"
								aria-label="Pick a payment icon"
								class="flex h-9 w-12 items-center justify-center rounded-md border bg-muted/30 text-xl leading-none transition-colors hover:bg-accent"
							>
								{iconFor(selectedFriend.id)}
							</button>
						</div>
						<div class="space-y-1">
							<Label class="text-xs">Pay (CB)</Label>
							<Input type="number" name="amount" min="1" required class="w-24" placeholder="0" />
						</div>
						<div class="flex-1 space-y-1">
							<Label class="text-xs">Note (optional)</Label>
							<Input name="memo" placeholder="What's it for?" maxlength={140} />
						</div>
						<Button type="submit">Pay {selectedFriend.displayName}</Button>
					</form>
				{/if}
			</CardContent>
				</div>
			</div>
		</Card>
	{/if}

	<!-- Add / request -->
	<Card class="overflow-hidden">
		<div class="flex items-stretch">
			<div class="hidden w-40 shrink-0 items-center justify-center overflow-hidden border-r bg-primary/5 p-2 sm:flex lg:w-48">
				<img
					src="/cala-watching.png"
					alt="Cala the dog patiently holding an envelope, waiting to deliver it."
					class="h-56 w-full select-none object-contain"
				/>
			</div>
			<div class="min-w-0 flex-1">
				<CardHeader>
					<CardTitle level={2}>Add a friend</CardTitle>
					<CardDescription>They need a Crub Bucks account, and must approve your request.</CardDescription>
				</CardHeader>
				<CardContent>
					{#if form?.requestError}
						<Alert variant="destructive" class="mb-4"><AlertDescription>{form.requestError}</AlertDescription></Alert>
					{:else if form?.requestMessage}
						<Alert variant="success" class="mb-4"><AlertDescription>{form.requestMessage}</AlertDescription></Alert>
					{/if}
					<form method="POST" action="?/request" use:enhance class="flex flex-col gap-3 sm:flex-row sm:items-end">
						<div class="flex-1 space-y-2">
							<Label for="email">Friend's email</Label>
							<Input id="email" name="email" type="email" placeholder="friend@example.com" required value={form?.email ?? ''} />
						</div>
						<Button type="submit">Send request</Button>
					</form>
				</CardContent>
			</div>
		</div>
	</Card>

	<!-- Incoming requests -->
	{#if data.incoming.length > 0}
		<section>
			<h2 class="flex items-center gap-3 text-xl font-semibold tracking-tight">
				Friend requests
				<Badge>{data.incoming.length}</Badge>
			</h2>
			<div class="mt-3 space-y-2">
				{#each data.incoming as r (r.requestId)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{r.displayName}</div>
								<div class="text-xs text-muted-foreground">{r.email} · wants to be friends</div>
							</div>
							<div class="flex gap-2">
								<form method="POST" action="?/accept" use:enhance>
									<input type="hidden" name="requestId" value={r.requestId} />
									<Button type="submit">Approve</Button>
								</form>
								<form method="POST" action="?/deny" use:enhance>
									<input type="hidden" name="requestId" value={r.requestId} />
									<Button type="submit" variant="outline">Deny</Button>
								</form>
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Outgoing pending -->
	{#if data.outgoing.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Pending (sent)</h2>
			<div class="mt-3 space-y-2">
				{#each data.outgoing as r (r.requestId)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{r.displayName}</div>
								<div class="text-xs text-muted-foreground">{r.email} · awaiting their approval</div>
							</div>
							<form method="POST" action="?/cancel" use:enhance>
								<input type="hidden" name="requestId" value={r.requestId} />
								<Button type="submit" variant="ghost">Cancel</Button>
							</form>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Invited (not yet on Crub Bucks) -->
	{#if data.invites.length > 0}
		<section>
			<h2 class="text-xl font-semibold tracking-tight">Invited (not yet joined)</h2>
			<div class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
				{#each data.invites as inv (inv.id)}
					<Card>
						<CardContent class="flex flex-wrap items-center justify-between gap-3 py-4">
							<div>
								<div class="font-medium">{inv.email}</div>
								<div class="text-xs text-muted-foreground">
									Invite emailed · you'll connect when they sign up
								</div>
							</div>
							<form method="POST" action="?/cancelInvite" use:enhance>
								<input type="hidden" name="inviteId" value={inv.id} />
								<Button type="submit" variant="ghost">Cancel</Button>
							</form>
						</CardContent>
					</Card>
				{/each}
			</div>
		</section>
	{/if}

	<!-- Friends list + unified action panel -->
	<section>
		<div class="flex flex-wrap items-end justify-between gap-3">
			<h2 class="text-xl font-semibold tracking-tight">
				Your friends ({data.friends.length})
				{#if friendFilter.trim() !== '' && filteredFriends.length !== data.friends.length}
					<span class="ml-1 text-sm font-normal text-muted-foreground">
						· {filteredFriends.length} match{filteredFriends.length === 1 ? '' : 'es'}
					</span>
				{/if}
			</h2>
			{#if data.friends.length > 5}
				<div class="w-full sm:w-64">
					<Input
						type="search"
						placeholder="Filter by name or email…"
						bind:value={friendFilter}
						aria-label="Filter friends"
					/>
				</div>
			{/if}
		</div>

		{#if form?.favoriteError}
			<Alert variant="destructive" class="mt-3"><AlertDescription>{form.favoriteError}</AlertDescription></Alert>
		{/if}

		{#if data.friends.length === 0}
			<Card class="mt-3">
				<CardContent class="flex flex-col items-center gap-3 py-8 text-center text-muted-foreground">
					<img
						src="/cala-empty-friends.png"
						alt="Cala the dog sitting alone, waiting for someone to play."
						width="600"
						height="600"
						class="h-40 w-auto select-none opacity-90"
					/>
					No friends yet. Send a request above to get started.
				</CardContent>
			</Card>
		{:else if filteredFriends.length === 0}
			<Card class="mt-3">
				<CardContent class="py-8 text-center text-sm text-muted-foreground">
					No friends match “{friendFilter}”.
				</CardContent>
			</Card>
		{:else}
			<div class="mt-4 space-y-3">
				{#if filteredFavorites.length > 0}
					<div>
						<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							Favorites
						</h3>
						<div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
							{#each filteredFavorites as f (f.id)}
								{@render friendRow(f)}
							{/each}
						</div>
					</div>
				{/if}
				{#if filteredOthers.length > 0}
					<div>
						{#if filteredFavorites.length > 0}
							<h3 class="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
								All friends
							</h3>
						{/if}
						<div class="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
							{#each filteredOthers as f (f.id)}
								{@render friendRow(f)}
							{/each}
						</div>
					</div>
				{/if}
			</div>
		{/if}
	</section>
</div>

{#snippet friendRow(f: { id: string; displayName: string; email: string; isFavorite: boolean; avatarUpdatedAt: Date | string | null })}
	{@const isSelected = selectedFriendId === f.id}
	<div
		class="group flex items-center gap-2 rounded-lg border bg-card shadow-sm transition-colors {isSelected
			? 'border-primary ring-1 ring-primary'
			: 'hover:bg-accent'}"
	>
		<!-- Favorite toggle. Form-on-button so it works without JS too; use:enhance
		     re-fetches data and the star updates from the server. -->
		<form method="POST" action="?/favorite" use:enhance class="shrink-0 pl-3">
			<input type="hidden" name="friendId" value={f.id} />
			<input type="hidden" name="isFavorite" value={!f.isFavorite} />
			<button
				type="submit"
				aria-label={f.isFavorite ? `Unfavorite ${f.displayName}` : `Favorite ${f.displayName}`}
				aria-pressed={f.isFavorite}
				class="flex h-9 w-9 items-center justify-center rounded text-xl leading-none transition-colors {f.isFavorite
					? 'text-yellow-500 hover:text-yellow-600'
					: 'text-muted-foreground hover:text-foreground'}"
			>
				{f.isFavorite ? '★' : '☆'}
			</button>
		</form>
		<!-- Row body: click to select. -->
		<button
			type="button"
			onclick={() => (selectedFriendId = isSelected ? null : f.id)}
			class="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-3 text-left"
			aria-pressed={isSelected}
		>
			<Avatar id={f.id} name={f.displayName} avatarUpdatedAt={f.avatarUpdatedAt} size={36} />
			<div class="min-w-0">
				<div class="truncate font-medium">{f.displayName}</div>
				<div class="truncate text-xs text-muted-foreground">{f.email}</div>
			</div>
		</button>
		<!-- Unfriend, revealed on row hover (desktop) or when the button itself is
		     focused (keyboard). Selecting the row no longer reveals it. Always
		     visible on touch / small viewports since there's no hover there. -->
		<form
			method="POST"
			action="?/unfriend"
			use:enhance
			class="ml-auto shrink-0 pr-3 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100"
			onsubmit={(e) => {
				if (!confirm(`Unfriend ${f.displayName}?`)) e.preventDefault();
			}}
		>
			<input type="hidden" name="friendId" value={f.id} />
			<Button
				type="submit"
				variant="ghost"
				size="sm"
				class="text-destructive hover:bg-destructive/10 hover:text-destructive"
			>
				Unfriend
			</Button>
		</form>
	</div>
{/snippet}

<svelte:window onkeydown={onKeydown} />

<!-- Shared emoji picker: one instance, opened from the pay form. The mount
     container stays in the DOM (so the picker's emoji DB only loads once);
     the surrounding overlay is shown only while pickerOpen is true. -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
	class:hidden={!pickerOpen}
	role="presentation"
	onclick={onBackdropClick}
>
	<div
		role="dialog"
		aria-label="Emoji picker"
		aria-modal="true"
		class="w-[20rem] overflow-hidden rounded-md border bg-popover shadow-lg sm:w-[22rem]"
	>
		<div bind:this={pickerMount}></div>
	</div>
</div>
