<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto, invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import SettingsDialog from '$lib/components/SettingsDialog.svelte';
	import Shield from '@lucide/svelte/icons/shield';
	import { isSoundEnabled, play, warmUpSound, type SoundName } from '$lib/sound';
	import { formatAmount } from '$lib/format';

	let { data, children }: { data: LayoutData; children: any } = $props();

	// Header balance, sign-coloured. Updates live with the layout poll.
	const balanceClass = $derived(
		data.balance > 0
			? 'text-success'
			: data.balance < 0
				? 'text-destructive'
				: 'text-muted-foreground'
	);

	// --- Sound cues ----------------------------------------------------------
	// The polled layout data carries a few "latest event" signals. We play a cue
	// once when a signal changes from what this device last saw. The first
	// observation on a device is seeded silently unless the event is fresh, so
	// logging in doesn't replay history.
	const FRESH_MS = 60_000;

	function readLS(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	}
	function writeLS(key: string, val: string): void {
		try {
			localStorage.setItem(key, val);
		} catch {
			// ignore (private mode, etc.)
		}
	}

	// Fire a cue when `token` differs from the last value stored under `key`.
	// First observation is silent unless `atMs` is within FRESH_MS.
	function cueOnChange(
		key: string,
		token: string | null,
		atMs: number | null,
		pick: SoundName | (() => SoundName | null)
	): void {
		if (!token) return;
		const seen = readLS(key);
		if (seen === token) return;
		writeLS(key, token);
		const fresh = atMs !== null && Date.now() - atMs < FRESH_MS;
		if (seen === null && !fresh) return;
		const name = typeof pick === 'function' ? pick() : pick;
		if (name && isSoundEnabled()) play(name);
	}

	// Gained CB (cash) / lost CB (slide), plus bet went-live (yes) / cancelled (no).
	$effect(() => {
		const s = data.sound;
		const actAt = s.lastActivityAt ? new Date(s.lastActivityAt).getTime() : null;
		cueOnChange('cb:lastActivity', s.lastTransferId, actAt, () =>
			s.lastDelta > 0 ? 'cash' : s.lastDelta < 0 ? 'slide' : null
		);
		const liveAt = s.lastBetLiveAt ? new Date(s.lastBetLiveAt).getTime() : null;
		cueOnChange('cb:lastBetLive', liveAt ? String(liveAt) : null, liveAt, 'yes');
		const cancAt = s.lastBetCancelledAt ? new Date(s.lastBetCancelledAt).getTime() : null;
		cueOnChange('cb:lastBetCancelled', cancAt ? String(cancAt) : null, cancAt, 'no');
		// You earned an award → celebratory fanfare.
		const badgeAt = s.lastBadgeAt ? new Date(s.lastBadgeAt).getTime() : null;
		cueOnChange('cb:lastBadge', badgeAt ? String(badgeAt) : null, badgeAt, 'wow');
	});

	// Friend request received → "hello there" (only on an increase in the count).
	$effect(() => {
		const count = data.pendingFriendRequests;
		const seen = readLS('cb:friendReqCount');
		writeLS('cb:friendReqCount', String(count));
		if (seen === null) return; // seed silently
		if (count > Number(seen) && isSoundEnabled()) play('hello');
	});

	// Lightweight poll so live changes — incoming payments, sound cues,
	// notifications, friend-request counts, AND the current page's own data
	// (e.g. a bet flipping to accepted while you're on the Bets page) — surface
	// without a manual refresh. invalidateAll() re-runs every loader, so the
	// page you're on updates too, not just the layout. Pauses while the tab is
	// hidden and fires once on becoming visible again, to avoid background churn.
	const POLL_MS = 20_000;
	onMount(() => {
		warmUpSound();
		const tick = () => {
			if (document.visibilityState === 'visible') invalidateAll();
		};
		const timer = setInterval(tick, POLL_MS);
		document.addEventListener('visibilitychange', tick);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', tick);
		};
	});

	type AlertVariant = 'info' | 'success' | 'warning' | 'default';
	function alertVariantFor(level: 'info' | 'success' | 'warning'): AlertVariant {
		// 'info' as the base level — the Alert component has an 'info' variant.
		return level;
	}

	const navlinks = [
		{ href: '/app', label: 'Bets', exact: true },
		{ href: '/app/feed', label: 'Feed' },
		{ href: '/app/sports', label: 'Sports' },
		{ href: '/app/account', label: 'Account' },
		{ href: '/app/friends', label: 'Friends' },
		{ href: '/app/awards', label: 'Awards' }
	];

	function isActive(href: string, exact?: boolean): boolean {
		if (exact) return page.url.pathname === href;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

	// --- Swipe between tabs (mobile only) ------------------------------------
	// A horizontal swipe on the page body moves to the adjacent primary tab,
	// mirroring the mobile tab strip. Tapping the tabs still works; this is a
	// progressive enhancement layered on top.
	function currentTabIndex(): number {
		// Walk in order so a sub-page like /app/feed/123 resolves to "Feed"
		// rather than the exact-match "Bets".
		let idx = 0;
		navlinks.forEach((l, i) => {
			if (isActive(l.href, l.exact)) idx = i;
		});
		return idx;
	}

	const SWIPE_MIN_PX = 60; // horizontal distance to count as a swipe
	let touchStartX = 0;
	let touchStartY = 0;
	let tracking = false;

	function onTouchStart(e: TouchEvent) {
		// Only one finger, only on narrow viewports (the tab strip's breakpoint),
		// and not inside something that opts out (e.g. a horizontally scrollable
		// region marked data-no-swipe).
		if (e.touches.length !== 1 || !window.matchMedia('(max-width: 639px)').matches) {
			tracking = false;
			return;
		}
		if (e.target instanceof Element && e.target.closest('[data-no-swipe]')) {
			tracking = false;
			return;
		}
		tracking = true;
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	}

	function onTouchEnd(e: TouchEvent) {
		if (!tracking) return;
		tracking = false;
		const t = e.changedTouches[0];
		const dx = t.clientX - touchStartX;
		const dy = t.clientY - touchStartY;
		// Decisive, predominantly horizontal gesture only — don't hijack scrolls.
		if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
		const next = currentTabIndex() + (dx < 0 ? 1 : -1); // swipe left ⇒ next tab
		if (next < 0 || next >= navlinks.length) return;
		goto(navlinks[next].href);
	}
</script>

<div class="kibble-bg min-h-screen bg-background text-foreground">
	<header class="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
			<div class="flex items-center gap-4">
				<a href="/app" class="flex items-center gap-2 font-semibold tracking-tight">
					<span
						class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm"
						>₡</span
					>
					<span>Crub Bucks</span>
					<span class="tabular-nums {balanceClass}"
						>{formatAmount(data.balance, data.locale)} ₡</span
					>
				</a>
				<!-- Desktop nav lives inline with the brand. The mobile tab strip
				     below the brand row takes over under sm. -->
				<nav class="hidden items-center gap-1 text-sm sm:flex">
					{#each navlinks as l (l.href)}
						<a
							href={l.href}
							class="relative rounded-md px-3 py-1.5 transition-colors hover:bg-accent {isActive(
								l.href,
								l.exact
							)
								? 'bg-accent font-medium text-accent-foreground'
								: 'text-muted-foreground'}"
						>
							{l.label}
							{#if l.href === '/app/friends' && data.pendingFriendRequests > 0}
								<span
									class="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
								>
									{data.pendingFriendRequests}
								</span>
							{/if}
						</a>
					{/each}
				</nav>
			</div>
			<div class="flex items-center gap-2">
				<span class="hidden text-sm text-muted-foreground sm:inline">{data.user.displayName}</span>
				{#if data.user.role === 'admin'}
					<a
						href="/admin"
						class="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<Shield class="size-4" />
						<span class="hidden sm:inline">Admin</span>
					</a>
				{/if}
				<SettingsDialog user={data.user} />
			</div>
		</div>

		<!-- Mobile tab bar. Hidden on sm+ since the desktop nav (above) lives
		     inline with the brand there. Equal-width tabs with an underline
		     indicator on the active one. Sits inside the sticky header so it
		     stays pinned as the page scrolls. -->
		<nav class="flex border-t text-sm sm:hidden" aria-label="Primary">
			{#each navlinks as l (l.href)}
				<a
					href={l.href}
					aria-current={isActive(l.href, l.exact) ? 'page' : undefined}
					class="relative flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 transition-colors {isActive(
						l.href,
						l.exact
					)
						? 'border-primary font-medium text-foreground'
						: 'border-transparent text-muted-foreground hover:bg-accent'}"
				>
					{l.label}
					{#if l.href === '/app/friends' && data.pendingFriendRequests > 0}
						<span
							class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground"
						>
							{data.pendingFriendRequests}
						</span>
					{/if}
				</a>
			{/each}
		</nav>
	</header>

	<main class="mx-auto max-w-5xl px-6 py-8" ontouchstart={onTouchStart} ontouchend={onTouchEnd}>
		{#if data.notifications.length > 0}
			<div class="mb-6 space-y-2">
				{#if data.notifications.length > 1}
					<div class="flex justify-end">
						<form method="POST" action="/app/notifications?/dismissAll" use:enhance>
							<input type="hidden" name="from" value={page.url.pathname + page.url.search} />
							<button
								type="submit"
								class="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								Clear all
							</button>
						</form>
					</div>
				{/if}
				{#each data.notifications as n (n.id)}
					<Alert variant={alertVariantFor(n.level)} class="relative pr-12">
						<div class="flex items-center gap-3">
							{#if n.icon}
								<img
									src={n.icon}
									alt=""
									width="40"
									height="40"
									class="h-10 w-10 shrink-0 select-none object-contain"
									draggable="false"
									onerror={(e) => ((e.currentTarget as HTMLImageElement).src = '/icon-192.png')}
								/>
							{/if}
							<div class="min-w-0 flex-1">
								{#if n.link}
									<a
										href={n.link}
										class="block rounded-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									>
										<AlertTitle>{n.title}</AlertTitle>
										{#if n.body}
											<AlertDescription class="no-underline">{n.body}</AlertDescription>
										{/if}
									</a>
								{:else}
									<AlertTitle>{n.title}</AlertTitle>
									{#if n.body}
										<AlertDescription>{n.body}</AlertDescription>
									{/if}
								{/if}
							</div>
						</div>
						<form
							method="POST"
							action="/app/notifications?/dismiss"
							use:enhance
							class="absolute right-2 top-2"
						>
							<input type="hidden" name="id" value={n.id} />
							<input type="hidden" name="from" value={page.url.pathname + page.url.search} />
							<button
								type="submit"
								aria-label="Dismiss notification"
								class="inline-flex h-7 w-7 items-center justify-center rounded-md text-current/70 hover:bg-foreground/10"
							>
								<svg
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 20 20"
									fill="currentColor"
									class="h-4 w-4"
									aria-hidden="true"
								>
									<path
										fill-rule="evenodd"
										d="M4.22 4.22a.75.75 0 011.06 0L10 8.94l4.72-4.72a.75.75 0 111.06 1.06L11.06 10l4.72 4.72a.75.75 0 11-1.06 1.06L10 11.06l-4.72 4.72a.75.75 0 01-1.06-1.06L8.94 10 4.22 5.28a.75.75 0 010-1.06z"
										clip-rule="evenodd"
									/>
								</svg>
							</button>
						</form>
					</Alert>
				{/each}
			</div>
		{/if}
		{@render children()}
	</main>
</div>
