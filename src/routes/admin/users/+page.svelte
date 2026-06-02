<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import {
		Table,
		TableHeader,
		TableBody,
		TableRow,
		TableHead,
		TableCell
	} from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import { Card, CardContent } from '$lib/components/ui/card';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function fmt(d: Date | string | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}
</script>

<div class="space-y-6">
	<header>
		<h1 class="text-3xl font-bold tracking-tight">Users</h1>
		<p class="mt-1 text-muted-foreground">
			{data.users.length.toLocaleString()} total
		</p>
	</header>

	{#if form && 'error' in form && form.error}
		<Alert variant="destructive"><AlertDescription>{form.error}</AlertDescription></Alert>
	{/if}

	<Card>
		<CardContent class="p-0">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>User</TableHead>
						<TableHead>Role</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Balance</TableHead>
						<TableHead>Last login</TableHead>
						<TableHead>Joined</TableHead>
						<TableHead class="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.users as u (u.id)}
						<TableRow>
							<TableCell>
								<div class="font-medium">{u.displayName}</div>
								<div class="text-xs text-muted-foreground">{u.email}</div>
							</TableCell>
							<TableCell>
								<Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
									{u.role}
								</Badge>
							</TableCell>
							<TableCell>
								{#if !u.isActive}
									<Badge variant="destructive">Suspended</Badge>
								{:else if !u.emailVerifiedAt}
									<Badge variant="outline">Unverified</Badge>
								{:else}
									<Badge variant="success">Active</Badge>
								{/if}
								{#if u.failedLoginCount > 0}
									<span class="ml-2 text-xs text-muted-foreground">{u.failedLoginCount} fail{u.failedLoginCount === 1 ? '' : 's'}</span>
								{/if}
							</TableCell>
							<TableCell>
								<form
									method="POST"
									action="?/setBalance"
									use:enhance
									class="flex items-center gap-1"
								>
									<input type="hidden" name="userId" value={u.id} />
									<Input
										name="balance"
										type="number"
										step="1"
										value={u.balance}
										aria-label={`Balance for ${u.displayName}`}
										class="h-8 w-24 text-right tabular-nums"
									/>
									<span class="text-xs text-muted-foreground">₡</span>
									<Button type="submit" size="sm" variant="outline">Set</Button>
								</form>
							</TableCell>
							<TableCell class="text-sm text-muted-foreground">
								{fmt(u.lastLoginAt)}
							</TableCell>
							<TableCell class="text-sm text-muted-foreground">{fmt(u.createdAt)}</TableCell>
							<TableCell class="text-right">
								<div class="flex justify-end gap-1">
									{#if u.isActive}
										<form method="POST" action="?/suspend" use:enhance>
											<input type="hidden" name="userId" value={u.id} />
											<Button type="submit" size="sm" variant="outline">Suspend</Button>
										</form>
									{:else}
										<form method="POST" action="?/unsuspend" use:enhance>
											<input type="hidden" name="userId" value={u.id} />
											<Button type="submit" size="sm" variant="outline">Unsuspend</Button>
										</form>
									{/if}
									{#if u.role === 'admin'}
										<form method="POST" action="?/demote" use:enhance>
											<input type="hidden" name="userId" value={u.id} />
											<Button type="submit" size="sm" variant="ghost">Demote</Button>
										</form>
									{:else}
										<form method="POST" action="?/promote" use:enhance>
											<input type="hidden" name="userId" value={u.id} />
											<Button type="submit" size="sm" variant="ghost">Promote</Button>
										</form>
									{/if}
								</div>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</CardContent>
	</Card>
</div>
