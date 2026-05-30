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

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const cfg = $derived(data.config);
</script>

<div class="space-y-8">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">System</h1>
		<p class="mt-1 text-muted-foreground">Operational toggles that affect every user.</p>
	</header>

	<!-- Maintenance mode -->
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div>
					<CardTitle level={2}>Maintenance mode</CardTitle>
					<CardDescription>
						When on, non-admin traffic is bounced to a maintenance page. Use during migrations
						or incidents.
					</CardDescription>
				</div>
				{#if cfg.maintenanceMode}
					<Badge variant="destructive">ON</Badge>
				{:else}
					<Badge variant="secondary">OFF</Badge>
				{/if}
			</div>
		</CardHeader>
		<CardContent>
			<form method="POST" action="?/maintenance" use:enhance class="space-y-3">
				<div class="flex items-center gap-2">
					<input
						id="maint-enabled"
						type="checkbox"
						name="enabled"
						checked={cfg.maintenanceMode}
						class="h-4 w-4 rounded border-input"
					/>
					<Label for="maint-enabled">Enable maintenance mode</Label>
				</div>
				<div class="space-y-2">
					<Label for="maint-message">Message to show users (optional)</Label>
					<Input
						id="maint-message"
						name="message"
						value={cfg.maintenanceMessage ?? ''}
						placeholder="We'll be back shortly."
					/>
				</div>
				<Button type="submit">Save</Button>
				{#if form?.ok === 'maintenance'}
					<span class="ml-2 text-sm text-muted-foreground">Saved.</span>
				{/if}
			</form>
		</CardContent>
	</Card>

	<!-- Registration lock -->
	<Card>
		<CardHeader>
			<div class="flex items-center justify-between">
				<div>
					<CardTitle level={2}>Registration lock</CardTitle>
					<CardDescription>
						When on, the registration form is disabled and submissions are rejected.
					</CardDescription>
				</div>
				{#if cfg.registrationLock}
					<Badge variant="destructive">LOCKED</Badge>
				{:else}
					<Badge variant="success">OPEN</Badge>
				{/if}
			</div>
		</CardHeader>
		<CardContent>
			<form method="POST" action="?/registrationLock" use:enhance class="space-y-3">
				<div class="flex items-center gap-2">
					<input
						id="reglock-enabled"
						type="checkbox"
						name="enabled"
						checked={cfg.registrationLock}
						class="h-4 w-4 rounded border-input"
					/>
					<Label for="reglock-enabled">Lock new registrations</Label>
				</div>
				<div class="space-y-2">
					<Label for="reglock-message">Message to show on the registration page</Label>
					<Input
						id="reglock-message"
						name="message"
						value={cfg.registrationLockMessage ?? ''}
						placeholder="Registration is closed."
					/>
				</div>
				<Button type="submit">Save</Button>
				{#if form?.ok === 'registrationLock'}
					<span class="ml-2 text-sm text-muted-foreground">Saved.</span>
				{/if}
			</form>
		</CardContent>
	</Card>

	<p class="text-sm text-muted-foreground">
		Looking for the broadcast banner? It moved to
		<a href="/admin/notifications" class="text-primary hover:underline">Notifications</a> — now
		dismissible per user, and you can target a single user too.
	</p>
</div>
