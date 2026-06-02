<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import {
		Table,
		TableHeader,
		TableBody,
		TableRow,
		TableHead,
		TableCell
	} from '$lib/components/ui/table';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { formatAmount } from '$lib/format';
	import { evenSplitDeltas, winnerLoserDeltas, tieredDeltas } from '$lib/ledger-math';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const fmt = (n: number) => formatAmount(n, data.locale);
	const mode = $derived(data.bet.mode);
	const pool = $derived(Number(data.bet.pool ?? 0));
	const open = $derived(data.bet.status === 'open');
	const pending = $derived(data.bet.status === 'pending');
	const settled = $derived(data.bet.status === 'resolved' || data.bet.status === 'cancelled');
	const myPart = $derived(data.participants.find((p) => p.userId === data.myUserId));
	const iAccepted = $derived(!!myPart?.acceptedAt);

	function fmtDate(d: Date | string | null): string {
		if (!d) return '—';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
	}
	function signed(n: number): string {
		return n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : fmt(0);
	}
	function deltaClass(n: number): string {
		return n > 0 ? 'text-success' : n < 0 ? 'text-destructive' : 'text-muted-foreground';
	}

	// --- pooled resolution state ------------------------------------------
	let winnerId = $state('');
	let loserId = $state(''); // winner_loser
	let loserOrderIds = $state<string[]>([]); // tiered (least → most)

	const nonWinnerIds = $derived(data.participants.map((p) => p.userId).filter((u) => u !== winnerId));

	// Reset tiered order whenever the winner changes.
	$effect(() => {
		void winnerId;
		loserOrderIds = data.participants.map((p) => p.userId).filter((u) => u !== winnerId);
	});

	// Winner / Loser mode shortcut: when there are exactly two participants,
	// picking the winner uniquely determines the loser — auto-fill it so the
	// user doesn't have to click the same fact twice. With three or more
	// participants the loser is genuinely a choice (any third+ rides along
	// at 0), so we only do this for the head-to-head case.
	$effect(() => {
		if (mode !== 'winner_loser') return;
		if (data.participants.length !== 2) return;
		if (!winnerId) return;
		const other = data.participants.find((p) => p.userId !== winnerId);
		if (other && loserId !== other.userId) loserId = other.userId;
	});

	function moveLoser(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= loserOrderIds.length) return;
		const next = [...loserOrderIds];
		[next[i], next[j]] = [next[j], next[i]];
		loserOrderIds = next;
	}

	// Drag-and-drop reordering (with the ↑/↓ buttons as a keyboard/touch fallback).
	let dragIndex = $state<number | null>(null);
	function onDrop(target: number) {
		if (dragIndex === null || dragIndex === target) return;
		const next = [...loserOrderIds];
		const [moved] = next.splice(dragIndex, 1);
		next.splice(target, 0, moved);
		loserOrderIds = next;
		dragIndex = null;
	}

	const nameById = $derived(new Map(data.participants.map((p) => [p.userId, p.displayName])));

	// Live preview of the per-person result for the current selection.
	const preview = $derived.by(() => {
		const m = new Map<string, number>();
		let deltas: { userId: string; delta: number }[] = [];
		if (mode === 'even_split' && winnerId) deltas = evenSplitDeltas(pool, winnerId, nonWinnerIds);
		else if (mode === 'winner_loser' && winnerId && loserId && winnerId !== loserId)
			deltas = winnerLoserDeltas(
				pool,
				winnerId,
				loserId,
				data.participants.map((p) => p.userId).filter((u) => u !== winnerId && u !== loserId)
			);
		else if (mode === 'tiered' && winnerId) deltas = tieredDeltas(pool, winnerId, loserOrderIds);
		for (const d of deltas) m.set(d.userId, d.delta);
		return m;
	});

	// --- custom resolution state ------------------------------------------
	// Empty to start; bind:group fills entries as radios are clicked. (Do NOT
	// initialise via an $effect that reads + writes `outcomes` — that self-loops
	// and throws effect_update_depth_exceeded, killing page interactivity.)
	let outcomes = $state<Record<string, 'won' | 'lost' | ''>>({});
	const cWinners = $derived(data.participants.filter((p) => outcomes[p.userId] === 'won'));
	const cLosers = $derived(data.participants.filter((p) => outcomes[p.userId] === 'lost'));
	const cWin = $derived(cWinners.reduce((s, p) => s + (p.payoutIfWin ?? 0), 0));
	const cLose = $derived(cLosers.reduce((s, p) => s + (p.lossIfLose ?? 0), 0));
	const cAllChosen = $derived(
		data.participants.every((p) => outcomes[p.userId] === 'won' || outcomes[p.userId] === 'lost')
	);
	const cBalanced = $derived(cAllChosen && cWin === cLose && cWin > 0);

	// --- pot mode -------------------------------------------------------------
	let winnings = $state<Record<string, number>>({});
	const winningsTotal = $derived(
		data.participants.reduce((s, p) => s + (Number(winnings[p.userId]) || 0), 0)
	);
	const potTotal = $derived(Number(data.bet.pool ?? 0));
	const potRemaining = $derived(potTotal - winningsTotal);
	const potBalanced = $derived(
		mode === 'pot' &&
			potTotal > 0 &&
			winningsTotal === potTotal &&
			data.participants.every((p) => Number.isFinite(Number(winnings[p.userId])))
	);

	const canSettle = $derived(
		mode === 'custom'
			? cBalanced
			: mode === 'even_split'
				? !!winnerId
				: mode === 'winner_loser'
					? !!winnerId && !!loserId && winnerId !== loserId
					: mode === 'tiered'
						? !!winnerId
						: /* pot */ potBalanced
	);

	const modeLabel: Record<string, string> = {
		even_split: 'Even split',
		winner_loser: 'Winner / Loser',
		tiered: 'Tiered',
		pot: 'Pot',
		custom: 'Custom'
	};
</script>

<div class="space-y-6">
	<header>
		<a href="/app" class="text-sm text-muted-foreground hover:text-foreground">← Bets</a>
		<div class="mt-1 flex items-start gap-4">
			<div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-4xl leading-none sm:h-20 sm:w-20 sm:text-5xl">
				{data.bet.icon ?? '💰'}
			</div>
			<div class="min-w-0 flex-1">
				<h1 class="text-3xl font-bold tracking-tight">{data.bet.title}</h1>
				<div class="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
					<Badge
						variant={data.bet.status === 'open'
							? 'default'
							: data.bet.status === 'resolved'
								? 'info'
								: data.bet.status === 'pending'
									? 'secondary'
									: 'destructive'}>{data.bet.status}</Badge
					>
					<Badge variant="secondary">{modeLabel[mode]}</Badge>
					{#if mode !== 'custom'}<span>pot {fmt(pool)} ₡</span>{/if}
					<span>· by {data.creatorName} · {fmtDate(data.bet.createdAt)}</span>
					{#if data.bet.resolvedAt}<span>· resolved {fmtDate(data.bet.resolvedAt)}</span>{/if}
				</div>
			</div>
		</div>
		{#if data.bet.status === 'resolved' && data.bet.resolutionNote}
			<p class="mt-2 rounded-md border bg-muted/30 p-3 text-sm">
				<span class="font-medium">Note:</span> {data.bet.resolutionNote}
			</p>
		{/if}
	</header>

	<!-- Resolved-bet personal reaction: Cala only appears when this bet has
	     a clear emotional outcome for the current viewer (win or loss). -->
	{#if data.bet.status === 'resolved'}
		{@const me = data.participants.find((p) => p.userId === data.myUserId)}
		{#if me && (me.settledDelta ?? 0) > 0}
			<Card class="overflow-hidden border-success/40 bg-success/5">
				<CardContent class="flex items-center gap-4 py-4">
					<img
						src="/cala-win-celebration.png"
						alt="Cala celebrating a win"
						width="160"
						height="214"
						class="max-h-28 max-w-[40%] select-none sm:max-h-32"
						draggable="false"
					/>
					<div class="min-w-0 flex-1">
						<div class="text-xs font-semibold uppercase tracking-wide text-success">You won</div>
						<div class="text-3xl font-bold tabular-nums text-success">
							+{fmt(me.settledDelta ?? 0)} ₡
						</div>
						<p class="mt-1 text-sm text-muted-foreground">Cala approves.</p>
					</div>
				</CardContent>
			</Card>
		{:else if me && (me.settledDelta ?? 0) < 0}
			<Card class="overflow-hidden border-destructive/40 bg-destructive/5">
				<CardContent class="flex items-center gap-4 py-4">
					<img
						src="/cala-oof.png"
						alt="Cala flopped over after a loss"
						width="220"
						height="123"
						class="max-h-28 max-w-[40%] select-none sm:max-h-32"
						draggable="false"
					/>
					<div class="min-w-0 flex-1">
						<div class="text-xs font-semibold uppercase tracking-wide text-destructive">Oof — you lost</div>
						<div class="text-3xl font-bold tabular-nums text-destructive">
							−{fmt(Math.abs(me.settledDelta ?? 0))} ₡
						</div>
						<p class="mt-1 text-sm text-muted-foreground">Cala's down too.</p>
					</div>
				</CardContent>
			</Card>
		{/if}
	{/if}

	<!-- Pending acceptance: the bet isn't live until everyone accepts; a single
	     decline calls it off. -->
	{#if pending}
		<Card>
			<CardHeader>
				<CardTitle level={2}>Waiting for everyone to accept</CardTitle>
				<CardDescription>
					This bet goes live once all {data.participants.length} participants accept. If anyone declines, it's called off.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				{#if form?.error}
					<Alert variant="destructive"><AlertDescription>{form.error}</AlertDescription></Alert>
				{/if}
				<ul class="space-y-1">
					{#each data.participants as p (p.userId)}
						<li class="flex items-center justify-between rounded-md border p-2 text-sm">
							<span>
								{p.displayName}{#if p.userId === data.myUserId}<span class="ml-1 text-xs text-muted-foreground">(you)</span>{/if}{#if p.userId === data.bet.createdBy}<span class="ml-1 text-xs text-muted-foreground">· creator</span>{/if}
							</span>
							{#if p.acceptedAt}<Badge variant="success">accepted</Badge>{:else}<Badge variant="secondary">awaiting</Badge>{/if}
						</li>
					{/each}
				</ul>

				{#if !iAccepted}
					<div class="flex gap-2">
						<form method="POST" action="?/accept" use:enhance>
							<Button type="submit">Accept bet</Button>
						</form>
						<form
							method="POST"
							action="?/decline"
							use:enhance
							onsubmit={(e) => {
								if (!confirm('Decline and call off this bet for everyone?')) e.preventDefault();
							}}
						>
							<Button type="submit" variant="outline">Decline</Button>
						</form>
					</div>
				{:else}
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p class="text-sm text-muted-foreground">You've accepted — waiting on the others.</p>
						<form
							method="POST"
							action="?/cancel"
							use:enhance
							onsubmit={(e) => {
								if (!confirm('Call off this bet?')) e.preventDefault();
							}}
						>
							<Button type="submit" variant="outline">Cancel bet</Button>
						</form>
					</div>
				{/if}
			</CardContent>
		</Card>
	{/if}

	<!-- Results table — only once the bet is settled. While it's open, the
	     Resolve card below is the single participant list (no duplication). -->
	{#if settled}
		<Card>
			<CardHeader>
				<CardTitle level={2}>Results</CardTitle>
			</CardHeader>
			<CardContent class="p-0">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Member</TableHead>
							<TableHead class="text-right">Result</TableHead>
							<TableHead>Outcome</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{#each data.participants as p (p.userId)}
							<TableRow>
								<TableCell>
									{p.displayName}{#if p.userId === data.myUserId}<span class="ml-1 text-xs text-muted-foreground">(you)</span>{/if}
								</TableCell>
								<TableCell class="text-right tabular-nums {deltaClass(p.settledDelta ?? 0)}">
									{signed(p.settledDelta ?? 0)}
								</TableCell>
								<TableCell>
									{#if p.outcome === 'won'}<Badge variant="success">won</Badge>
									{:else if p.outcome === 'lost'}<Badge variant="destructive">lost{#if p.lossRank}<span class="ml-1 opacity-80">#{p.lossRank}</span>{/if}</Badge>
									{:else if p.outcome === 'none'}<Badge variant="secondary">—</Badge>
									{:else}<Badge variant="secondary">pending</Badge>{/if}
								</TableCell>
							</TableRow>
						{/each}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	{/if}

	{#if open && mode === 'pot'}
		<Card>
			<CardHeader>
				<CardTitle level={2}>Buy back in</CardTitle>
				<CardDescription>
					Add more to the pot. You can only re-buy for yourself.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form method="POST" action="?/rebuy" use:enhance class="flex flex-wrap items-end gap-2">
					<div class="space-y-2">
						<Label for="rebuy-amount">Amount (₡)</Label>
						<Input id="rebuy-amount" name="amount" type="number" min="1" required class="w-32" placeholder="100" />
					</div>
					<Button type="submit">Re-buy</Button>
				</form>
			</CardContent>
		</Card>
	{/if}

	{#if open}
		<Card>
			<CardHeader>
				<CardTitle level={2}>Resolve this bet</CardTitle>
				<CardDescription>
					{#if mode === 'even_split'}Pick the winner — everyone else splits the {fmt(pool)} ₡ pot equally.
					{:else if mode === 'winner_loser'}Pick the winner and the loser; the loser pays the {fmt(pool)} ₡ pot, others net zero.
					{:else if mode === 'tiered'}Pick the winner, then order the losers — last place pays the most.
					{:else if mode === 'pot'}Enter each player's winnings. They must total the {fmt(pool)} ₡ pot exactly.
					{:else}Mark each participant won or lost; winner payouts must equal loser losses.
					{/if}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{#if form?.error}
					<Alert variant="destructive" class="mb-4"><AlertDescription>{form.error}</AlertDescription></Alert>
				{/if}

				<form method="POST" action="?/resolve" use:enhance class="space-y-4">
					{#if mode === 'custom'}
						<div class="space-y-2">
							{#each data.participants as p (p.userId)}
								<div class="flex items-center justify-between rounded-md border p-3">
									<div>
										<div class="font-medium">{p.displayName}</div>
										<div class="text-xs text-muted-foreground">+{fmt(p.payoutIfWin ?? 0)} if win · −{fmt(p.lossIfLose ?? 0)} if lose</div>
									</div>
									<div class="flex gap-3 text-sm">
										<label class="flex items-center gap-1.5"><input type="radio" name={`outcome[${p.userId}]`} value="won" bind:group={outcomes[p.userId]} class="h-4 w-4" /> won</label>
										<label class="flex items-center gap-1.5"><input type="radio" name={`outcome[${p.userId}]`} value="lost" bind:group={outcomes[p.userId]} class="h-4 w-4" /> lost</label>
									</div>
								</div>
							{/each}
						</div>
						<div class="rounded-md border bg-muted/30 p-3 text-sm">
							winners total: <strong class="tabular-nums">{fmt(cWin)}</strong> · losers total:
							<strong class="tabular-nums">{fmt(cLose)}</strong>
							{#if cAllChosen}{#if cBalanced}<Badge variant="success" class="ml-2">balanced</Badge>{:else}<Badge variant="destructive" class="ml-2">won't balance</Badge>{/if}{/if}
						</div>
					{:else if mode === 'pot'}
						<!-- Pot: enter each player's winnings; sum must equal the pot -->
						<div class="space-y-2">
							<Label>Winnings per player</Label>
							<p class="text-xs text-muted-foreground">
								Each row shows their buy-in so far. Enter their final winnings.
							</p>
							<div class="space-y-1">
								{#each data.participants as p (p.userId)}
									{@const bi = Number(p.boughtIn ?? 0)}
									{@const w = Number(winnings[p.userId] ?? 0)}
									{@const net = (Number.isFinite(w) ? w : 0) - bi}
									<div class="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm">
										<div class="flex-1">
											<div class="font-medium">{p.displayName}{#if p.userId === data.myUserId}<span class="ml-1 text-xs text-muted-foreground">(you)</span>{/if}</div>
											<div class="text-xs text-muted-foreground">bought in {fmt(bi)} ₡</div>
										</div>
										<div class="flex items-center gap-2">
											<Label for={`winnings-${p.userId}`} class="text-xs">winnings</Label>
											<Input
												id={`winnings-${p.userId}`}
												name={`winnings[${p.userId}]`}
												type="number"
												min="0"
												step="1"
												class="w-24"
												bind:value={winnings[p.userId]}
											/>
											<span class="w-20 text-right tabular-nums {deltaClass(net)}">
												{Number.isFinite(w) ? signed(net) : ''}
											</span>
										</div>
									</div>
								{/each}
							</div>
							<div class="rounded-md border bg-muted/30 p-3 text-sm">
								allocated: <strong class="tabular-nums">{fmt(winningsTotal)}</strong> of
								<strong class="tabular-nums">{fmt(potTotal)}</strong> ₡ · remaining:
								<strong class="tabular-nums {potRemaining === 0 ? 'text-success' : 'text-destructive'}">{fmt(potRemaining)}</strong>
								{#if potBalanced}<Badge variant="success" class="ml-2">balanced</Badge>{:else if winningsTotal > 0}<Badge variant="destructive" class="ml-2">{potRemaining > 0 ? 'short' : 'over'}</Badge>{/if}
							</div>
						</div>
					{:else}
						<!-- Pooled: pick winner -->
						<div class="space-y-2">
							<Label>Winner</Label>
							<div class="space-y-1">
								{#each data.participants as p (p.userId)}
									<label class="flex items-center gap-2 rounded-md border p-2 text-sm">
										<input type="radio" name="winnerId" value={p.userId} bind:group={winnerId} class="h-4 w-4" />
										<span class="flex-1">{p.displayName}</span>
										{#if preview.has(p.userId)}<span class="tabular-nums {deltaClass(preview.get(p.userId) ?? 0)}">{signed(preview.get(p.userId) ?? 0)} ₡</span>{/if}
									</label>
								{/each}
							</div>
						</div>

						{#if mode === 'winner_loser' && winnerId && data.participants.length > 2}
							<div class="space-y-2">
								<Label>Loser (pays the pot)</Label>
								<div class="space-y-1">
									{#each data.participants.filter((p) => p.userId !== winnerId) as p (p.userId)}
										<label class="flex items-center gap-2 rounded-md border p-2 text-sm">
											<input type="radio" name="loserId" value={p.userId} bind:group={loserId} class="h-4 w-4" />
											<span class="flex-1">{p.displayName}</span>
											{#if preview.has(p.userId)}<span class="tabular-nums {deltaClass(preview.get(p.userId) ?? 0)}">{signed(preview.get(p.userId) ?? 0)} ₡</span>{/if}
										</label>
									{/each}
								</div>
							</div>
						{/if}
						{#if mode === 'winner_loser' && winnerId && data.participants.length === 2}
							<!-- Hidden input still needed: the action expects `loserId` in
							     formData. The radio group above only renders for 3+ players;
							     in head-to-head the loser is implied by the winner. -->
							<input type="hidden" name="loserId" value={loserId} />
						{/if}

						{#if mode === 'tiered' && winnerId}
							<div class="space-y-2">
								<Label>Loser order</Label>
								<p class="text-xs text-muted-foreground">
									Drag to reorder (or use the arrows). Top of the list pays the least, bottom pays
									the most.
								</p>
								<input type="hidden" name="loserOrder" value={loserOrderIds.join(',')} />
								<div class="space-y-1">
									{#each loserOrderIds as id, i (id)}
										<div
											role="listitem"
											draggable="true"
											ondragstart={() => (dragIndex = i)}
											ondragover={(e) => e.preventDefault()}
											ondrop={(e) => {
												e.preventDefault();
												onDrop(i);
											}}
											ondragend={() => (dragIndex = null)}
											class="flex items-center gap-2 rounded-md border p-2 text-sm transition-colors {dragIndex ===
											i
												? 'opacity-50'
												: ''} cursor-grab active:cursor-grabbing"
										>
											<GripVertical class="size-4 shrink-0 text-muted-foreground" />
											<span class="w-5 text-center text-muted-foreground">{i + 1}</span>
											<span class="flex-1">{nameById.get(id)}</span>
											<span class="text-xs text-muted-foreground">loses</span>
											<span class="tabular-nums font-medium text-destructive"
												>{signed(preview.get(id) ?? 0)} ₡</span
											>
											<div class="flex gap-1">
												<Button type="button" variant="ghost" size="icon" onclick={() => moveLoser(i, -1)} disabled={i === 0} aria-label="Move up">↑</Button>
												<Button type="button" variant="ghost" size="icon" onclick={() => moveLoser(i, 1)} disabled={i === loserOrderIds.length - 1} aria-label="Move down">↓</Button>
											</div>
										</div>
									{/each}
								</div>
							</div>
						{/if}
					{/if}

					<div class="space-y-2">
						<Label for="note">Comment (optional)</Label>
						<Input id="note" name="note" placeholder="How'd it go?" maxlength={280} />
					</div>

					<div class="flex gap-2">
						<Button type="submit" disabled={!canSettle}>Settle</Button>
						<!-- Same form, but this submitter posts to the cancel action and
						     skips the resolve-field validation. -->
						<Button type="submit" variant="outline" formaction="?/cancel" formnovalidate>
							Cancel bet
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
