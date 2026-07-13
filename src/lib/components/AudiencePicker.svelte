<script lang="ts">
	// Claim-audience picker. Off by default → the task is open to all friends.
	// When "limit" is on, the chosen friends' ids post as repeated `audience`
	// fields (the server re-validates them against the creator's real friends).
	let {
		friends,
		limited = $bindable(false),
		selected = $bindable<string[]>([])
	}: {
		friends: { id: string; displayName: string }[];
		limited?: boolean;
		selected?: string[];
	} = $props();

	function toggle(id: string) {
		selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
	}
</script>

<div class="space-y-2">
	<label class="flex cursor-pointer items-center gap-2 text-sm select-none">
		<input type="checkbox" class="h-4 w-4 rounded border-input" bind:checked={limited} />
		<span>Limit to specific friends</span>
	</label>

	{#if limited}
		{#if friends.length === 0}
			<p class="text-xs text-muted-foreground">Add friends first to limit who can claim.</p>
		{:else}
			<div class="flex flex-wrap gap-1">
				{#each friends as f (f.id)}
					<button
						type="button"
						onclick={() => toggle(f.id)}
						aria-pressed={selected.includes(f.id)}
						class="h-8 rounded-md border px-3 text-xs font-medium transition-colors {selected.includes(
							f.id
						)
							? 'border-primary bg-primary text-primary-foreground'
							: 'border-input bg-transparent text-muted-foreground hover:bg-muted'}"
					>
						{f.displayName}
					</button>
				{/each}
			</div>
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
