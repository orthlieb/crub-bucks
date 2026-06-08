<script lang="ts">
	import type { PageData } from './$types';
	import {
		Table,
		TableHeader,
		TableBody,
		TableRow,
		TableHead,
		TableCell
	} from '$lib/components/ui/table';
	import { Badge } from '$lib/components/ui/badge';
	import { Card, CardContent } from '$lib/components/ui/card';

	let { data }: { data: PageData } = $props();

	function fmt(d: Date | string): string {
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString();
	}

	function badgeVariant(
		t: string
	): 'default' | 'destructive' | 'success' | 'secondary' | 'outline' {
		if (t === 'login_failure' || t === 'lockout') return 'destructive';
		if (t === 'login_success' || t === 'email_verified' || t === 'password_reset_completed')
			return 'success';
		if (t.startsWith('admin_')) return 'default';
		return 'secondary';
	}

	function fmtMeta(m: unknown): string {
		if (!m) return '';
		try {
			return JSON.stringify(m);
		} catch {
			return '';
		}
	}
</script>

<div class="space-y-6">
	<header class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Security events</h1>
			<p class="mt-1 text-muted-foreground">
				Latest {data.pageSize} events
				{#if data.typeFilter}
					· filter: <code class="rounded bg-muted px-1.5 py-0.5 text-xs">{data.typeFilter}</code
					>{/if}
			</p>
		</div>

		<form method="GET" class="flex items-center gap-2">
			<label class="text-sm text-muted-foreground" for="type">Type</label>
			<select
				id="type"
				name="type"
				class="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
				onchange={(e) => (e.currentTarget.form as HTMLFormElement).submit()}
			>
				<option value="">All</option>
				{#each data.availableTypes as t (t)}
					<option value={t} selected={data.typeFilter === t}>{t}</option>
				{/each}
			</select>
		</form>
	</header>

	<Card>
		<CardContent class="p-0">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead class="w-44">When</TableHead>
						<TableHead class="w-48">Type</TableHead>
						<TableHead>User</TableHead>
						<TableHead>IP</TableHead>
						<TableHead>Metadata</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each data.events as e (e.id)}
						<TableRow>
							<TableCell class="text-sm text-muted-foreground">{fmt(e.createdAt)}</TableCell>
							<TableCell>
								<Badge variant={badgeVariant(e.eventType)}>{e.eventType}</Badge>
							</TableCell>
							<TableCell class="text-sm">
								{#if e.userEmail}
									<div>{e.userDisplayName}</div>
									<div class="text-xs text-muted-foreground">{e.userEmail}</div>
								{:else}
									<span class="text-muted-foreground">—</span>
								{/if}
							</TableCell>
							<TableCell class="font-mono text-xs">{e.ipAddress ?? '—'}</TableCell>
							<TableCell class="max-w-md truncate font-mono text-xs text-muted-foreground">
								{fmtMeta(e.metadata)}
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</CardContent>
	</Card>
</div>
