<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page as pageState } from '$app/state';
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

	// The user row whose Set-balance input the server flagged, to highlight in red.
	const balanceErrUserId = $derived(
		form && 'field' in form && form.field === 'balance' && 'userId' in form
			? (form.userId as string)
			: undefined
	);

	// Likewise for the Rename input.
	const nameErrUserId = $derived(
		form && 'field' in form && form.field === 'displayName' && 'userId' in form
			? (form.userId as string)
			: undefined
	);

	function fmt(d: Date | string | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleDateString(undefined, {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	// URL-driven filters + pagination. Changing a filter resets to page 1.
	// Seeded from the loaded query once (avoids a typing race on re-load).
	let q = $state('');
	onMount(() => {
		q = data.q;
	});
	let searchTimer: ReturnType<typeof setTimeout>;

	function navigate(updates: Record<string, string>, resetPage = true) {
		const sp = new URLSearchParams(pageState.url.searchParams);
		for (const [k, v] of Object.entries(updates)) {
			if (v) sp.set(k, v);
			else sp.delete(k);
		}
		if (resetPage) sp.delete('page');
		const qs = sp.toString();
		goto(qs ? `?${qs}` : '?', { keepFocus: true, noScroll: true });
	}

	function onSearchInput() {
		clearTimeout(searchTimer);
		const v = q;
		searchTimer = setTimeout(() => navigate({ q: v }), 300);
	}

	const selectClass =
		'h-9 rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

	const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));
	const from = $derived(data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
	const to = $derived(Math.min(data.page * data.pageSize, data.total));
</script>

<div class="space-y-6">
	<header class="space-y-3">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Users</h1>
			<p class="mt-1 text-muted-foreground">{data.total.toLocaleString()} total</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<Input
				type="search"
				placeholder="Search name or email…"
				bind:value={q}
				oninput={onSearchInput}
				aria-label="Search users"
				autocomplete="off"
				class="w-full sm:max-w-xs"
			/>
			<select
				class={selectClass}
				value={data.role}
				onchange={(e) => navigate({ role: e.currentTarget.value })}
				aria-label="Filter by role"
			>
				<option value="">All roles</option>
				<option value="user">User</option>
				<option value="admin">Admin</option>
			</select>
			<select
				class={selectClass}
				value={data.status}
				onchange={(e) => navigate({ status: e.currentTarget.value })}
				aria-label="Filter by status"
			>
				<option value="">All statuses</option>
				<option value="active">Active</option>
				<option value="suspended">Suspended</option>
				<option value="unverified">Unverified</option>
			</select>
		</div>
	</header>

	{#if form && 'error' in form && form.error && !balanceErrUserId && !nameErrUserId}
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
								<form method="POST" action="?/rename" use:enhance class="flex items-center gap-1">
									<input type="hidden" name="userId" value={u.id} />
									<Input
										name="displayName"
										value={u.displayName}
										maxlength={40}
										aria-label={`Display name for ${u.displayName}`}
										class="h-8 w-44"
										aria-invalid={nameErrUserId === u.id}
									/>
									<Button type="submit" size="sm" variant="outline">Rename</Button>
								</form>
								<div class="mt-1 text-xs text-muted-foreground">{u.email}</div>
								{#if nameErrUserId === u.id && form && 'error' in form}
									<p class="mt-1 text-xs text-destructive">{form.error}</p>
								{/if}
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
									<span class="ml-2 text-xs text-muted-foreground"
										>{u.failedLoginCount} fail{u.failedLoginCount === 1 ? '' : 's'}</span
									>
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
										aria-invalid={balanceErrUserId === u.id}
									/>
									<span class="text-xs text-muted-foreground">₡</span>
									<Button type="submit" size="sm" variant="outline">Set</Button>
								</form>
								{#if balanceErrUserId === u.id && form && 'error' in form}
									<p class="mt-1 text-xs text-destructive">{form.error}</p>
								{/if}
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
					{:else}
						<TableRow>
							<TableCell colspan={7} class="py-8 text-center text-sm text-muted-foreground">
								No users match these filters.
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</CardContent>
	</Card>

	<div class="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
		<span>{from}–{to} of {data.total.toLocaleString()}</span>
		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				size="sm"
				disabled={data.page <= 1}
				onclick={() => navigate({ page: String(data.page - 1) }, false)}
			>
				Prev
			</Button>
			<span>Page {data.page} of {totalPages}</span>
			<Button
				variant="outline"
				size="sm"
				disabled={data.page >= totalPages}
				onclick={() => navigate({ page: String(data.page + 1) }, false)}
			>
				Next
			</Button>
		</div>
	</div>
</div>
