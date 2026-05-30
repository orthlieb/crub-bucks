<script lang="ts">
	import { page } from '$app/state';
	import type { LayoutData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children, data }: { children: any; data: LayoutData } = $props();

	const tabs = [
		{ href: '/admin', label: 'Overview', exact: true },
		{ href: '/admin/users', label: 'Users' },
		{ href: '/admin/notifications', label: 'Notifications' },
		{ href: '/admin/security-events', label: 'Security events' },
		{ href: '/admin/system', label: 'System' }
	];

	function isActive(href: string, exact?: boolean): boolean {
		if (exact) return page.url.pathname === href;
		return page.url.pathname === href || page.url.pathname.startsWith(`${href}/`);
	}
</script>

<div class="min-h-screen bg-background">
	<header class="border-b">
		<div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
			<div class="flex items-center gap-3">
				<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
					<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
					<span>Crub Bucks</span>
				</a>
				<span class="text-muted-foreground">/</span>
				<span class="font-medium">Admin</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-sm text-muted-foreground">{data.user.displayName}</span>
				<ThemeToggle />
				<Button href="/app" variant="outline" size="sm">Back to app</Button>
				<form method="POST" action="/logout?/default">
					<Button type="submit" variant="ghost" size="sm">Log out</Button>
				</form>
			</div>
		</div>
		<nav class="mx-auto flex max-w-6xl items-center gap-1 px-6 pb-2 text-sm">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class="rounded-md px-3 py-1.5 transition-colors hover:bg-accent {isActive(
						tab.href,
						tab.exact
					)
						? 'bg-accent font-medium text-accent-foreground'
						: 'text-muted-foreground'}"
				>
					{tab.label}
				</a>
			{/each}
		</nav>
	</header>

	<Separator />

	<main class="mx-auto max-w-6xl px-6 py-8">
		{@render children()}
	</main>
</div>
