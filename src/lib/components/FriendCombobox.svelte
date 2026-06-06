<script lang="ts" module>
	export interface ComboFriend {
		id: string;
		displayName: string;
		email: string;
		isFavorite?: boolean;
	}
</script>

<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import X from '@lucide/svelte/icons/x';

	// A typeahead friend selector (extracted from the Pay-a-friend picker). Only
	// the matching suggestions render, so it scales to hundreds of friends — no
	// giant scrolling checklist. Single mode binds `value`; multiple mode binds
	// `selectedIds` and shows removable chips.
	let {
		friends,
		multiple = false,
		value = $bindable(null),
		selectedIds = $bindable([]),
		placeholder = 'Start typing a name or email…',
		id = 'friend-combobox',
		max = 20
	}: {
		friends: ComboFriend[];
		multiple?: boolean;
		/** Single-select: the chosen friend id (or null). */
		value?: string | null;
		/** Multi-select: the chosen friend ids. */
		selectedIds?: string[];
		placeholder?: string;
		id?: string;
		/** Cap on suggestions shown at once. */
		max?: number;
	} = $props();

	const byId = $derived(new Map(friends.map((f) => [f.id, f])));

	let query = $state('');
	let open = $state(false);
	let highlight = $state(0);

	// Substring match on name OR email; hide already-chosen friends; cap the list.
	const suggestions = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return [];
		const taken = new Set(multiple ? selectedIds : value ? [value] : []);
		return friends
			.filter((f) => !taken.has(f.id))
			.filter(
				(f) => f.displayName.toLowerCase().includes(q) || f.email.toLowerCase().includes(q)
			)
			.slice(0, max);
	});

	// Reset the keyboard highlight whenever the suggestion set changes.
	$effect(() => {
		suggestions.length;
		highlight = 0;
	});

	function pick(fid: string) {
		if (multiple) {
			if (!selectedIds.includes(fid)) selectedIds = [...selectedIds, fid];
		} else {
			value = fid;
		}
		query = '';
		open = false;
	}

	function remove(fid: string) {
		if (multiple) selectedIds = selectedIds.filter((x) => x !== fid);
		else value = null;
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open || suggestions.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlight = (highlight + 1) % suggestions.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlight = (highlight - 1 + suggestions.length) % suggestions.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const hit = suggestions[highlight];
			if (hit) pick(hit.id);
		} else if (e.key === 'Escape') {
			open = false;
		}
	}

	const chips = $derived(
		multiple ? (selectedIds.map((sid) => byId.get(sid)).filter(Boolean) as ComboFriend[]) : []
	);
</script>

<div class="space-y-2">
	{#if multiple && chips.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each chips as f (f.id)}
				<span
					class="inline-flex items-center gap-1 rounded-full border bg-muted py-1 pl-2.5 pr-1 text-xs"
				>
					{#if f.isFavorite}<span aria-hidden="true" class="text-yellow-500">★</span>{/if}{f.displayName}
					<button
						type="button"
						class="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
						aria-label={`Remove ${f.displayName}`}
						onclick={() => remove(f.id)}
					>
						<X size={12} />
					</button>
				</span>
			{/each}
		</div>
	{/if}

	<div class="relative">
		<Input
			{id}
			type="search"
			autocomplete="off"
			{placeholder}
			bind:value={query}
			oninput={() => (open = query.trim().length > 0)}
			onfocus={() => {
				if (query.trim().length > 0) open = true;
			}}
			onblur={() => setTimeout(() => (open = false), 120)}
			onkeydown={onKeydown}
			aria-expanded={open}
			aria-autocomplete="list"
			aria-controls={`${id}-suggestions`}
		/>
		{#if open && suggestions.length > 0}
			<ul
				id={`${id}-suggestions`}
				role="listbox"
				class="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
			>
				{#each suggestions as f, i (f.id)}
					<li
						role="option"
						aria-selected={highlight === i}
						class="cursor-pointer px-3 py-2 text-sm {highlight === i
							? 'bg-accent'
							: 'hover:bg-accent'}"
						onmousedown={(e) => {
							// mousedown beats input blur so the pick registers before close.
							e.preventDefault();
							pick(f.id);
						}}
						onmouseenter={() => (highlight = i)}
					>
						<div class="font-medium">
							{#if f.isFavorite}<span aria-hidden="true" class="text-yellow-500">★</span> {/if}{f.displayName}
						</div>
						<div class="text-xs text-muted-foreground">{f.email}</div>
					</li>
				{/each}
			</ul>
		{:else if open && query.trim().length > 0}
			<div
				class="absolute left-0 right-0 z-10 mt-1 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg"
			>
				No friends match “{query}”.
			</div>
		{/if}
	</div>
</div>
