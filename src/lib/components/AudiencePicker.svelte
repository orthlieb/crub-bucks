<script lang="ts">
	import FriendCombobox, { type ComboFriend } from '$lib/components/FriendCombobox.svelte';

	// Claim-audience picker. Off by default → the task is open to all friends.
	// When "limit" is on, this is the SAME control the bet-participants picker
	// uses: a name/email typeahead (FriendCombobox) plus favourite quick-adds.
	// The chosen ids post as repeated `audience` fields (the server re-validates
	// them against the creator's real friends).
	let {
		friends,
		limited = $bindable(false),
		selected = $bindable<string[]>([])
	}: {
		friends: ComboFriend[];
		limited?: boolean;
		selected?: string[];
	} = $props();

	const favorites = $derived(friends.filter((f) => f.isFavorite));

	function toggleFriend(id: string, on: boolean) {
		if (on) {
			if (!selected.includes(id)) selected = [...selected, id];
		} else {
			selected = selected.filter((x) => x !== id);
		}
	}
</script>

<div class="space-y-2">
	<label class="flex cursor-pointer items-center gap-2 text-sm select-none">
		<input type="checkbox" class="h-4 w-4 rounded border-input" bind:checked={limited} />
		<span>Limit to specific friends</span>
	</label>

	{#if limited}
		{#if friends.length === 0}
			<p class="text-xs text-muted-foreground">
				No friends yet — <a href="/app/friends" class="text-primary hover:underline">add some</a>.
			</p>
		{:else}
			<FriendCombobox
				id="task-audience"
				{friends}
				multiple
				bind:selectedIds={selected}
				placeholder="Add a friend by name or email…"
			/>
			{#if favorites.length > 0}
				<div class="space-y-1.5">
					<p class="text-xs text-muted-foreground">Quick add favourites</p>
					<div class="flex flex-wrap gap-1.5">
						{#each favorites as f (f.id)}
							<label
								class="inline-flex cursor-pointer items-center gap-1.5 rounded-full border py-1 pr-2.5 pl-2 text-xs transition-colors hover:bg-accent has-[:checked]:border-primary has-[:checked]:bg-accent"
							>
								<input
									type="checkbox"
									class="h-3.5 w-3.5"
									checked={selected.includes(f.id)}
									onchange={(e) => toggleFriend(f.id, e.currentTarget.checked)}
								/>
								<span aria-hidden="true" class="text-yellow-500">★</span>{f.displayName}
							</label>
						{/each}
					</div>
				</div>
			{/if}
			{#each selected as id (id)}
				<input type="hidden" name="audience" value={id} />
			{/each}
			<p class="text-xs text-muted-foreground">
				{#if selected.length === 0}
					No one picked yet — until you choose someone, any friend can claim.
				{:else}
					Only {selected.length} selected friend{selected.length === 1 ? '' : 's'} can claim.
				{/if}
			</p>
		{/if}
	{/if}
</div>
