<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { formatAmount } from '$lib/format';

	let { data }: { data: PageData } = $props();

	const stats = $derived(data.stats);
	const system = $derived(data.system);
	const fmt = (n: number) => formatAmount(n, data.locale);

	const cards = $derived([
		{ label: 'Total users', value: fmt(stats.users) },
		{ label: 'Verified', value: fmt(stats.verifiedUsers) },
		{ label: 'Active sessions', value: fmt(stats.activeSessions) },
		{ label: 'Open bets', value: fmt(stats.openBets) },
		{ label: 'Failed logins (24h)', value: fmt(stats.failedLogins24h) },
		{ label: 'Bank balance (₡)', value: fmt(stats.bankBalance) }
	]);
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Overview</h1>
		<p class="mt-1 text-muted-foreground">System health at a glance.</p>
	</header>

	{#if system.maintenanceMode}
		<Alert variant="destructive">
			<AlertTitle>Maintenance mode is on</AlertTitle>
			<AlertDescription>
				Non-admin traffic is being gated. Disable in the System tab when you're ready to reopen.
			</AlertDescription>
		</Alert>
	{/if}

	{#if system.registrationLock}
		<Alert>
			<AlertTitle>Registration is locked</AlertTitle>
			<AlertDescription>
				New signups are being refused. {system.registrationLockMessage ?? ''}
			</AlertDescription>
		</Alert>
	{/if}

	<section class="grid grid-cols-2 gap-4 md:grid-cols-3">
		{#each cards as c (c.label)}
			<Card>
				<CardHeader class="pb-2">
					<CardTitle level={3} class="text-sm font-medium text-muted-foreground">
						{c.label}
					</CardTitle>
				</CardHeader>
				<CardContent class="text-2xl font-bold">{c.value}</CardContent>
			</Card>
		{/each}
	</section>

	<section>
		<h2 class="text-xl font-semibold tracking-tight">Quick links</h2>
		<div class="mt-3 flex flex-wrap gap-2">
			<Badge variant="outline"><a href="/admin/users">Users</a></Badge>
			<Badge variant="outline"><a href="/admin/security-events">Security events</a></Badge>
			<Badge variant="outline"><a href="/admin/system">System controls</a></Badge>
		</div>
	</section>
</div>
