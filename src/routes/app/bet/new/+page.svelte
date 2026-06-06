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
	import BetModeIcon from '$lib/components/icons/BetModeIcon.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	type Mode = 'even_split' | 'winner_loser' | 'tiered' | 'pot';
	let mode = $state<Mode>('even_split');

	const modeInfo: Record<Mode, { label: string; blurb: string }> = {
		even_split: {
			label: 'Even split',
			blurb: 'One winner takes the pot; everyone else splits the loss equally.'
		},
		winner_loser: {
			label: 'Winner / Loser',
			blurb: 'One winner, one loser pays the whole pot; anyone else is along for the ride.'
		},
		tiered: {
			label: 'Tiered',
			blurb: 'One winner; losers pay by rank — last place pays the most (1/3, 2/3 … of the pot).'
		},
		pot: {
			label: 'Pot',
			blurb:
				'Everyone buys in for the same amount. Re-buys allowed while it’s open. At resolution you enter each person’s winnings.'
		}
	};

	// Pot-mode buy-in (live preview of the pot = buyIn × players).
	let buyIn = $state(100);

	// Pooled-mode friend selection.
	let selected = $state<Record<string, boolean>>({});
	const selectedCount = $derived(
		1 + data.friends.filter((f) => selected[f.id]).length // +1 = you
	);

	// Client-side filter for the "Who's in?" checklist. Selections are keyed
	// by friend.id in `selected`, so filtering only hides rows — checked
	// friends scrolled off-screen are still in the bet.
	let friendFilter = $state('');
	const filteredFriends = $derived.by(() => {
		const q = friendFilter.trim().toLowerCase();
		if (!q) return data.friends;
		return data.friends.filter(
			(f) => f.displayName.toLowerCase().includes(q) || f.email.toLowerCase().includes(q)
		);
	});
	const hiddenSelectedCount = $derived(
		data.friends.filter((f) => selected[f.id] && !filteredFriends.includes(f)).length
	);

	// Tiered blurb, live by player count: n players → 1 winner + (n−1) losers,
	// who pay 1/D, 2/D, … (n−1)/D of the pot, where D = n(n−1)/2.
	const tieredBlurb = $derived.by(() => {
		const n = selectedCount;
		// Before anyone's added, describe the mode like the others do (the
		// "add a friend" nudge lives in the participant validation, not here).
		if (n < 2) return modeInfo.tiered.blurb;
		const losers = n - 1;
		const denom = (n * (n - 1)) / 2;
		const fracs = Array.from({ length: losers }, (_, i) => `${i + 1}/${denom}`).join(', ');
		return `One winner takes the pot; the ${losers} loser${
			losers === 1 ? '' : 's'
		} pay ${fracs} of it by rank (last place pays the most).`;
	});

	// Bet icon. Defaults to the selected mode's emoji (even split ⚖️, winner/
	// loser 🏆, tiered 📶, pot 🪙, odds 🎲) and follows mode changes — until the
	// user explicitly picks one from the emoji picker, after which `iconCustom`
	// sticks and switching modes no longer overrides their choice.
	const MODE_ICON: Record<string, string> = {
		even_split: '⚖️',
		winner_loser: '🏆',
		tiered: '📶',
		pot: '🪙',
		odds: '🎲'
	};
	let icon = $state<string>(MODE_ICON.even_split);
	let iconCustom = $state(false);
	// A failed submit echoes the chosen icon back — treat that as the user's pick.
	$effect.pre(() => {
		if (form?.icon) {
			icon = form.icon;
			iconCustom = true;
		}
	});
	// Track the mode's default icon until the user customizes it.
	$effect(() => {
		const def = MODE_ICON[mode] ?? '💰';
		if (!iconCustom) icon = def;
	});

	// emoji-picker-element integration. The component is a self-registering
	// web component, so we dynamically import it after mount to keep it out
	// of the SSR bundle (and lazy-load its ~75 KB of code + data only when
	// the user actually visits the create-bet page). Picker is created once
	// and stays mounted (just visibility-toggled) so its emoji DB only loads
	// once even after multiple opens.
	let pickerOpen = $state(false);
	let pickerMount: HTMLDivElement | undefined = $state();
	let pickerInstance: HTMLElement | null = null;
	let themeObserver: MutationObserver | null = null;

	onMount(() => {
		let disposed = false;
		(async () => {
			const { Picker } = await import('emoji-picker-element');
			if (disposed || !pickerMount) return;
			const p = new Picker() as HTMLElement;

			// Sync with our class-based .dark theme override (the picker
			// otherwise follows prefers-color-scheme, which can disagree
			// with the user's app-level light/dark choice).
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
				if (detail?.unicode) {
					icon = detail.unicode;
					iconCustom = true; // user override — stop following the mode default
					pickerOpen = false;
				}
			});
			// Fit our popover width.
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

	// Click-outside to close the picker popover.
	let pickerPopover: HTMLDivElement | undefined = $state();
	function onDocClick(e: MouseEvent) {
		if (!pickerOpen) return;
		const t = e.target as Node | null;
		if (pickerPopover && t && !pickerPopover.contains(t)) pickerOpen = false;
	}
	$effect(() => {
		if (pickerOpen) {
			document.addEventListener('mousedown', onDocClick);
			return () => document.removeEventListener('mousedown', onDocClick);
		}
	});
</script>

<div class="space-y-6">
	<header>
		<a href="/app" class="text-sm text-muted-foreground hover:text-foreground">← Bets</a>
		<h1 class="mt-1 text-3xl font-bold tracking-tight">Create a bet</h1>
		<p class="mt-1 text-muted-foreground">Pick a type, set the pot, and choose who's in.</p>
	</header>

	<Card>
		<CardContent class="pt-6">
			{#if form?.error}
				<Alert variant="destructive" class="mb-4"><AlertDescription>{form.error}</AlertDescription></Alert>
			{/if}

			<form method="POST" use:enhance class="space-y-5">
				<input type="hidden" name="mode" value={mode} />

				<!-- Type picker -->
				<div class="space-y-2">
					<Label>Type</Label>
					<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
						{#each Object.entries(modeInfo) as [m, info] (m)}
							<button
								type="button"
								onclick={() => (mode = m as Mode)}
								class="flex items-center gap-2 rounded-md border p-3 text-left text-sm transition-colors {mode === m
									? 'border-primary bg-accent'
									: 'hover:bg-accent'}"
							>
								<BetModeIcon mode={m as Mode} size={18} class="shrink-0 text-muted-foreground" />
								<div class="font-medium">{info.label}</div>
							</button>
						{/each}
					</div>
					<p class="text-xs text-muted-foreground">
						{mode === 'tiered' ? tieredBlurb : modeInfo[mode].blurb}
					</p>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-[auto,1fr] sm:items-end">
					<div class="space-y-2">
						<Label>Icon</Label>
						<div class="relative" bind:this={pickerPopover}>
							<button
								type="button"
								onclick={() => (pickerOpen = !pickerOpen)}
								aria-haspopup="dialog"
								aria-expanded={pickerOpen}
								aria-label="Pick an icon"
								class="flex h-9 w-14 items-center justify-center rounded-md border bg-muted/30 text-2xl leading-none transition-colors hover:bg-accent"
							>
								{icon}
							</button>
							<!-- Container is always mounted so the picker (loaded once after
							     onMount) doesn't tear down + reload its emoji DB on every
							     open. We hide/show with class:hidden instead. -->
							<div
								bind:this={pickerMount}
								role="dialog"
								aria-label="Emoji picker"
								class="absolute left-0 top-full z-20 mt-1 w-[20rem] overflow-hidden rounded-md border bg-popover shadow-lg sm:w-[22rem]"
								class:hidden={!pickerOpen}
							></div>
						</div>
						<input type="hidden" name="icon" value={icon} />
					</div>
					<div class="space-y-2">
						<Label for="title">Title</Label>
						<Input id="title" name="title" required placeholder="What's the bet?" value={form?.title ?? ''} />
					</div>
				</div>

					<!-- Pooled modes: amount/stake + friend multi-select -->
					{#if mode === 'pot'}
						<div class="space-y-2">
							<Label for="stake">Buy-in per player</Label>
							<Input id="stake" name="stake" type="number" min="1" required bind:value={buyIn} class="max-w-40" />
							<p class="text-xs text-muted-foreground">
								Pot to start: <strong class="tabular-nums">{(buyIn * selectedCount).toLocaleString()}</strong>
								₡ ({selectedCount} player{selectedCount === 1 ? '' : 's'} × {buyIn} ₡). Re-buys grow the pot.
							</p>
						</div>
					{:else}
						<div class="space-y-2">
							<Label for="amount">Amount wagered (the pot the winner takes)</Label>
							<Input id="amount" name="amount" type="number" min="1" required placeholder="30" class="max-w-40" />
						</div>
					{/if}

					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<Label>Who's in?</Label>
							<span class="text-xs text-muted-foreground">{selectedCount} player{selectedCount === 1 ? '' : 's'}</span>
						</div>
						{#if data.friends.length > 5}
							<Input
								type="search"
								placeholder="Filter by name or email…"
								bind:value={friendFilter}
								aria-label="Filter friends"
							/>
						{/if}
						<div class="rounded-md border">
							<div class="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
								<input type="checkbox" checked disabled class="h-4 w-4" />
								{data.me.displayName} <span class="text-xs text-muted-foreground">(you — always in)</span>
							</div>
							{#if data.friends.length === 0}
								<p class="px-3 py-3 text-sm text-muted-foreground">
									No friends yet — <a href="/app/friends" class="text-primary hover:underline">add some</a>.
								</p>
							{:else if filteredFriends.length === 0}
								<p class="px-3 py-3 text-sm text-muted-foreground">
									No friends match “{friendFilter}”.
								</p>
							{:else}
								{#each filteredFriends as f (f.id)}
									<label class="flex items-center gap-2 border-b px-3 py-2 text-sm last:border-0">
										<input
											type="checkbox"
											name="participantId"
											value={f.id}
											bind:checked={selected[f.id]}
											class="h-4 w-4"
										/>
										{f.displayName}
									</label>
								{/each}
							{/if}
						</div>
						{#if hiddenSelectedCount > 0}
							<p class="text-xs text-muted-foreground">
								{hiddenSelectedCount} selected friend{hiddenSelectedCount === 1 ? '' : 's'}
								hidden by filter — still in the bet.
							</p>
						{/if}
						{#if mode === 'winner_loser'}
							<p class="text-xs text-muted-foreground">
								You'll name the one winner and the one loser when you resolve; extra players just
								ride along at 0.
							</p>
						{:else if mode === 'pot'}
							<p class="text-xs text-muted-foreground">
								Anyone in can re-buy while the bet's open (each grows the pot). At resolution you
								enter each player's winnings — they must total the pot.
							</p>
						{:else}
							<p class="text-xs text-muted-foreground">
								You'll name the winner when you resolve{mode === 'tiered' ? ' and rank the losers' : ''}.
							</p>
						{/if}
					</div>

				<div class="flex gap-2">
					<Button type="submit">Create bet</Button>
					<Button type="button" variant="outline" href="/app">Cancel</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
