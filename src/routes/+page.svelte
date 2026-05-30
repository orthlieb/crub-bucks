<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background text-foreground">
	<header
		class="mx-auto flex max-w-5xl items-center justify-between px-6 py-5"
	>
		<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
			<span
				class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm"
			>
				₡
			</span>
			<span>Crub Bucks</span>
		</a>

		<nav class="flex items-center gap-2">
			<ThemeToggle />
			<Button variant="ghost" size="sm" href="/about">About</Button>
			{#if data.user}
				<Button size="sm" href="/app">Open app</Button>
			{:else}
				<Button variant="ghost" size="sm" href="/login">Log in</Button>
				<Button size="sm" href="/register">Sign up</Button>
			{/if}
		</nav>
	</header>

	<main class="mx-auto max-w-5xl px-6 pb-24 pt-10">
		<section class="grid grid-cols-1 items-center gap-10 md:grid-cols-[1.1fr,1fr]">
			<div>
				<p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
					A closed-loop play currency
				</p>
				<h1
					class="mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl"
				>
					Settle bets, chores, and IOUs in
					<span class="text-primary">Crub Bucks</span>.
				</h1>
				<p class="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
					Crub Bucks have no real-world value. The system sums to zero by construction — for every
					buck someone's up, someone else is down. Wallets are allowed to go negative; the bank is
					bottomless.
				</p>

				<div class="mt-8 flex flex-wrap gap-3">
					{#if data.user}
						<Button size="lg" href="/app">Go to dashboard</Button>
					{:else}
						<Button size="lg" href="/register">Get started</Button>
						<Button size="lg" variant="outline" href="/login">I have an account</Button>
					{/if}
				</div>
			</div>

			<div class="relative mx-auto w-full max-w-md">
				<img
					src="/crub-buck.jpg"
					alt="A one Crub Buck note: purple, with Cala the dog as Governor of Bark."
					width="1024"
					height="440"
					class="w-full rotate-[-3deg] rounded-md shadow-2xl ring-1 ring-primary/20 transition-transform hover:rotate-0"
				/>
				<div class="pointer-events-none absolute -bottom-3 left-4 text-xs text-muted-foreground">
					Legal tender of <em>The Republic of Crub</em>.
				</div>
			</div>
		</section>

		<section class="mt-20 grid grid-cols-1 gap-4 sm:grid-cols-3">
			<Card>
				<CardHeader>
					<CardTitle level={3}>Zero-sum by design</CardTitle>
				</CardHeader>
				<CardContent class="text-sm text-muted-foreground">
					Every transfer debits one wallet and credits another by the same amount. The ledger
					can't drift out of balance.
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle level={3}>Negative is normal</CardTitle>
				</CardHeader>
				<CardContent class="text-sm text-muted-foreground">
					Lose a wager and dip below zero. No overdraft, no shame — just a number to win back.
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle level={3}>Friends, not groups</CardTitle>
				</CardHeader>
				<CardContent class="text-sm text-muted-foreground">
					Add friends by email. A bet is the only grouping — make one, add friends, set per-person
					payouts and losses, resolve whenever.
				</CardContent>
			</Card>
		</section>
	</main>
</div>

