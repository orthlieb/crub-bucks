<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { data, children }: { data: LayoutData; children: any } = $props();

	type AlertVariant = 'info' | 'success' | 'warning' | 'default';
	function alertVariantFor(level: 'info' | 'success' | 'warning'): AlertVariant {
		// 'info' as the base level — the Alert component has an 'info' variant.
		return level;
	}

	const navlinks = [
		{ href: '/app', label: 'Dashboard', exact: true },
		{ href: '/app/feed', label: 'Feed' },
		{ href: '/app/friends', label: 'Friends' }
	];

	function isActive(href: string, exact?: boolean): boolean {
		if (exact) return page.url.pathname === href;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}

</script>

<div class="kibble-bg min-h-screen bg-background text-foreground">
	<header class="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
			<div class="flex items-center gap-4">
				<a href="/app" class="flex items-center gap-2 font-semibold tracking-tight">
					<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
					<span>Crub Bucks</span>
				</a>
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
								<span class="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">
									{data.pendingFriendRequests}
								</span>
							{/if}
						</a>
					{/each}
				</nav>
			</div>
			<div class="flex items-center gap-2">
				<span class="hidden text-sm text-muted-foreground sm:inline">{data.user.displayName}</span>
				<ThemeToggle />
				{#if data.user.role === 'admin'}
					<Button variant="outline" size="sm" href="/admin">Admin</Button>
				{/if}
				<form method="POST" action="/logout">
					<Button variant="ghost" size="sm" type="submit">Log out</Button>
				</form>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-5xl px-6 py-8">
		{#if data.notifications.length > 0}
			<div class="mb-6 space-y-2">
				{#each data.notifications as n (n.id)}
					<Alert variant={alertVariantFor(n.level)} class="pr-12">
						<AlertTitle>{n.title}</AlertTitle>
						{#if n.body}
							<AlertDescription>{n.body}</AlertDescription>
						{/if}
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
