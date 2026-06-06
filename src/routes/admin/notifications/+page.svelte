<script lang="ts">
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
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let level = $state<'info' | 'success' | 'warning'>('info');
	let target = $state<'broadcast' | 'user'>('broadcast');

	// Optional click-through link. Presets cover the common in-app tabs; the
	// input takes any /app/... path (e.g. /app/bet/<id>) for ad-hoc testing.
	let link = $state('');
	const linkPresets = [
		{ label: 'Bets', value: '/app' },
		{ label: 'Feed', value: '/app/feed' },
		{ label: 'Friends', value: '/app/friends' },
		{ label: 'Awards', value: '/app/awards' }
	];

	// Typeahead state: user is searched via /admin/users/search.
	type UserHit = { id: string; displayName: string; email: string; isActive: boolean };
	let query = $state('');
	let results = $state<UserHit[]>([]);
	let highlighted = $state(0);
	let suggestionsOpen = $state(false);
	let isSearching = $state(false);
	let selected = $state<UserHit | null>(null);

	// Debounce the search so we don't hammer the endpoint on every keystroke.
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let lastQuery = '';

	function scheduleSearch(q: string) {
		if (searchTimer) clearTimeout(searchTimer);
		// Drop search if user clears or types < 2 chars.
		if (q.trim().length < 2) {
			results = [];
			suggestionsOpen = false;
			isSearching = false;
			return;
		}
		searchTimer = setTimeout(() => runSearch(q), 180);
	}

	async function runSearch(q: string) {
		isSearching = true;
		lastQuery = q;
		try {
			const res = await fetch(`/admin/users/search?q=${encodeURIComponent(q)}`);
			// Race guard: if a newer keystroke fired while we awaited, drop this.
			if (q !== lastQuery) return;
			if (!res.ok) {
				results = [];
				return;
			}
			results = await res.json();
			highlighted = 0;
			suggestionsOpen = results.length > 0;
		} catch {
			results = [];
		} finally {
			if (q === lastQuery) isSearching = false;
		}
	}

	function pick(u: UserHit) {
		selected = u;
		query = '';
		results = [];
		suggestionsOpen = false;
	}

	function clearSelection() {
		selected = null;
		query = '';
		// Refocus the input so the admin can keep going.
		queueMicrotask(() => document.getElementById('recipient-search')?.focus());
	}

	function onKeydown(e: KeyboardEvent) {
		if (!suggestionsOpen || results.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlighted = (highlighted + 1) % results.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlighted = (highlighted - 1 + results.length) % results.length;
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const hit = results[highlighted];
			if (hit) pick(hit);
		} else if (e.key === 'Escape') {
			suggestionsOpen = false;
		}
	}

	function fmtDate(d: Date | string): string {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Notifications</h1>
		<p class="mt-1 text-muted-foreground">
			Send a message to everyone or to one user. Recipients see it at the top of every app
			page and can dismiss it for themselves. Deleting here retracts it for everyone.
		</p>
	</header>

	<!-- Push self-test -->
	<Card>
		<CardHeader>
			<CardTitle level={2}>Test push notification</CardTitle>
			<CardDescription>
				Sends a Web Push to your own subscribed devices to verify delivery end-to-end.
				Enable Notifications in Settings first (in a real browser — not the embedded preview).
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.pushError}
				<Alert variant="destructive" class="mb-4">
					<AlertDescription>{form.pushError}</AlertDescription>
				</Alert>
			{/if}
			{#if form?.pushResult}
				<Alert variant="success" class="mb-4">
					<AlertDescription>{form.pushResult}</AlertDescription>
				</Alert>
			{/if}
			<form method="POST" action="?/testPush" use:enhance>
				<Button type="submit">Send myself a test push</Button>
			</form>
		</CardContent>
	</Card>

	<!-- Send form -->
	<Card>
		<CardHeader>
			<CardTitle level={2}>Send a notification</CardTitle>
			<CardDescription>
				Keep it short — title shows boldly, body is a sentence or two underneath.
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.error}
				<Alert variant="destructive" class="mb-4">
					<AlertDescription>{form.error}</AlertDescription>
				</Alert>
			{/if}
			{#if form?.ok === 'sent'}
				<Alert variant="success" class="mb-4">
					<AlertDescription>Notification sent.</AlertDescription>
				</Alert>
			{/if}

			<form method="POST" action="?/send" use:enhance class="space-y-4">
				<div class="space-y-2">
					<Label>Audience</Label>
					<div class="flex flex-wrap gap-2">
						<button
							type="button"
							onclick={() => (target = 'broadcast')}
							class="rounded-md border px-3 py-2 text-sm transition-colors {target === 'broadcast'
								? 'border-primary bg-accent'
								: 'hover:bg-accent'}"
						>
							Everyone
						</button>
						<button
							type="button"
							onclick={() => (target = 'user')}
							class="rounded-md border px-3 py-2 text-sm transition-colors {target === 'user'
								? 'border-primary bg-accent'
								: 'hover:bg-accent'}"
						>
							One user
						</button>
					</div>
					<input type="hidden" name="target" value={target} />
				</div>

				{#if target === 'user'}
					<div class="space-y-2">
						<Label for="recipient-search">Recipient</Label>
						<!-- userId is the source of truth the server reads. -->
						<input type="hidden" name="userId" value={selected?.id ?? ''} />

						{#if selected}
							<!-- Selected chip: shows who's targeted, with a Clear button to pick someone else. -->
							<div class="flex items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
								<div class="min-w-0">
									<div class="truncate font-medium">
										{selected.displayName}
										{#if !selected.isActive}
											<Badge variant="outline" class="ml-1 uppercase">suspended</Badge>
										{/if}
									</div>
									<div class="truncate text-xs text-muted-foreground">{selected.email}</div>
								</div>
								<Button type="button" variant="ghost" size="sm" onclick={clearSelection}>
									Change
								</Button>
							</div>
						{:else}
							<!-- Typeahead: 2-char minimum, 180ms debounce, /admin/users/search backs it. -->
							<div class="relative">
								<Input
									id="recipient-search"
									type="search"
									autocomplete="off"
									placeholder="Search by name or email…"
									bind:value={query}
									oninput={() => scheduleSearch(query)}
									onkeydown={onKeydown}
									onfocus={() => {
										if (results.length > 0) suggestionsOpen = true;
									}}
									onblur={() => {
										// Delay so a click on a suggestion can register first.
										setTimeout(() => (suggestionsOpen = false), 120);
									}}
									aria-expanded={suggestionsOpen}
									aria-autocomplete="list"
									aria-controls="recipient-suggestions"
								/>
								{#if suggestionsOpen && results.length > 0}
									<ul
										id="recipient-suggestions"
										role="listbox"
										class="absolute left-0 right-0 z-10 mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-lg"
									>
										{#each results as r, i (r.id)}
											<li
												role="option"
												aria-selected={highlighted === i}
												class="cursor-pointer px-3 py-2 text-sm {highlighted === i
													? 'bg-accent'
													: 'hover:bg-accent'}"
												onmousedown={(e) => {
													// mousedown beats the input's blur, so the click registers.
													e.preventDefault();
													pick(r);
												}}
												onmouseenter={() => (highlighted = i)}
											>
												<div class="font-medium">
													{r.displayName}
													{#if !r.isActive}
														<Badge variant="outline" class="ml-1 uppercase">suspended</Badge>
													{/if}
												</div>
												<div class="text-xs text-muted-foreground">{r.email}</div>
											</li>
										{/each}
									</ul>
								{:else if query.trim().length >= 2 && !isSearching && results.length === 0}
									<div class="absolute left-0 right-0 z-10 mt-1 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-lg">
										No users match “{query}”.
									</div>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground">
								Type at least 2 characters. Use ↑/↓ to navigate, Enter to pick.
							</p>
						{/if}
					</div>
				{/if}

				<div class="space-y-2">
					<Label>Level</Label>
					<div class="flex flex-wrap gap-2">
						{#each ['info', 'success', 'warning'] as l (l)}
							<button
								type="button"
								onclick={() => (level = l as 'info' | 'success' | 'warning')}
								class="rounded-md border px-3 py-2 text-sm capitalize transition-colors {level === l
									? 'border-primary bg-accent'
									: 'hover:bg-accent'}"
							>
								{l}
							</button>
						{/each}
					</div>
					<input type="hidden" name="level" value={level} />
				</div>

				<div class="space-y-2">
					<Label for="title">Title</Label>
					<Input id="title" name="title" required placeholder="Heads up: scheduled downtime tonight at 9 PM." />
				</div>
				<div class="space-y-2">
					<Label for="body">Body (optional)</Label>
					<Input id="body" name="body" placeholder="Should take about 15 minutes. Thanks for your patience." />
				</div>

				<div class="space-y-2">
					<Label for="link">Link (optional)</Label>
					<div class="flex flex-wrap gap-2">
						{#each linkPresets as p (p.value)}
							<button
								type="button"
								onclick={() => (link = p.value)}
								class="rounded-md border px-3 py-1.5 text-sm transition-colors {link === p.value
									? 'border-primary bg-accent'
									: 'hover:bg-accent'}"
							>
								{p.label}
							</button>
						{/each}
						{#if link}
							<button
								type="button"
								onclick={() => (link = '')}
								class="rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
							>
								Clear
							</button>
						{/if}
					</div>
					<Input id="link" name="link" bind:value={link} placeholder="/app/bet/<id> — where tapping the notification goes" />
					<p class="text-xs text-muted-foreground">
						Must be an in-app path starting with “/”. Drives both the in-app banner and the
						push notification's tap target.
					</p>
				</div>

				<Button type="submit">Send</Button>
			</form>
		</CardContent>
	</Card>

	<!-- Active notifications -->
	<Card>
		<CardHeader>
			<CardTitle level={2}>Active notifications</CardTitle>
			<CardDescription>
				Newest first. Delete to retract a notification for everyone (the user-side dismiss
				button only hides it for that one user).
			</CardDescription>
		</CardHeader>
		<CardContent>
			{#if form?.ok === 'deleted'}
				<Alert variant="success" class="mb-4">
					<AlertDescription>Notification deleted.</AlertDescription>
				</Alert>
			{/if}

			{#if data.items.length === 0}
				<p class="text-sm text-muted-foreground">Nothing sent yet.</p>
			{:else}
				<div class="divide-y">
					{#each data.items as n (n.id)}
						<div class="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
							<div class="min-w-0 space-y-1">
								<div class="flex flex-wrap items-center gap-2">
									<Badge
										variant={n.level === 'success'
											? 'success'
											: n.level === 'warning'
												? 'gold'
												: 'secondary'}
										class="uppercase">{n.level}</Badge
									>
									{#if n.isBroadcast}
										<Badge variant="info" class="uppercase">Everyone</Badge>
									{:else}
										<Badge variant="outline">→ {n.recipientName ?? 'Unknown'}</Badge>
									{/if}
									<span class="text-xs text-muted-foreground">{fmtDate(n.createdAt)}</span>
									{#if n.createdByName}
										<span class="text-xs text-muted-foreground">· by {n.createdByName}</span>
									{:else}
										<span class="text-xs text-muted-foreground">· system</span>
									{/if}
									{#if n.isBroadcast && n.dismissCount > 0}
										<span class="text-xs text-muted-foreground">· dismissed by {n.dismissCount}</span>
									{/if}
								</div>
								<div class="font-medium">{n.title}</div>
								{#if n.body}
									<div class="text-sm text-muted-foreground">{n.body}</div>
								{/if}
								{#if n.link}
									<a href={n.link} class="inline-block text-xs text-primary hover:underline">
										→ {n.link}
									</a>
								{/if}
							</div>
							<form method="POST" action="?/delete" use:enhance class="shrink-0">
								<input type="hidden" name="id" value={n.id} />
								<Button type="submit" variant="outline" size="sm">Delete</Button>
							</form>
						</div>
					{/each}
				</div>
			{/if}
		</CardContent>
	</Card>
</div>
