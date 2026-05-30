<script lang="ts">
	import type { PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Separator } from '$lib/components/ui/separator';

	let { data }: { data: PageData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background">
	<header class="border-b">
		<div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
			<a href="/" class="flex items-center gap-2 font-semibold tracking-tight">
				<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
				<span>Crub Bucks</span>
			</a>
			<nav class="flex items-center gap-2">
				<Button variant="ghost" size="sm" href="/about">About</Button>
				{#if data.user}
					<Button size="sm" href="/app">Open app</Button>
				{:else}
					<Button variant="ghost" size="sm" href="/login">Log in</Button>
					<Button size="sm" href="/register">Sign up</Button>
				{/if}
			</nav>
		</div>
	</header>

	<main class="mx-auto max-w-3xl px-6 py-12">
		<p class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">About</p>
		<h1 class="mt-3 text-4xl font-bold tracking-tight">A closed-loop play currency.</h1>

		<p class="mt-6 text-lg leading-relaxed text-muted-foreground">
			Crub Bucks (CB) is a way to track bets, chores, and IOUs among friends without anybody
			ever putting real money in. The whole system sums to zero by construction — for every CB
			that someone is up, someone else is down. Wallets are allowed to go negative, and the bank
			is bottomless.
		</p>

		<figure class="mt-10">
			<img
				src="/crub-buck.jpg"
				alt="A one Crub Buck note: purple, with Cala the dog as Governor of Bark."
				width="1024"
				height="440"
				class="w-full rounded-md shadow-xl ring-1 ring-primary/20"
			/>
			<figcaption class="mt-2 text-center text-xs text-muted-foreground">
				Issued by <em>The Republic of Crub</em>. Backed by the Tail Tuft Guarantee.
				Signed by the Governor of Bark and the Registrar of Puppiness.
			</figcaption>
		</figure>

		<Separator class="my-10" />

		<section class="space-y-8">
			<Card>
				<CardHeader>
					<CardTitle level={2}>Zero-sum by construction</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground">
					Every economic event is a transfer: one wallet's balance goes down, another's goes up,
					by the same amount, in one database transaction. Balances are never stored — they're
					derived by summing the ledger — so they cannot drift. Cumulative bugs in the math are
					impossible.
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle level={2}>One wallet, your friends</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground">
					Send a friend request by email; once they approve, you're connected (and either of you
					can unfriend later). Your single CB balance follows you everywhere. New players get a
					100 CB welcome grant from the Bank on first login — the Bank just goes that much more
					negative, keeping the books at zero.
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle level={2}>A public feed</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground">
					Like Venmo, there's a shared feed: who started a bet, who won (team games can have
					several winners), and who paid whom. Everyone signed in can follow along.
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle level={2}>Bets, made flexible</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground">
					No groups to set up — a bet <em>is</em> the grouping. You make a bet, add some friends
					(you're always in it too), and declare each person's potential payout (if they win) and
					loss (if they lose) — they don't have to be 1:1. Resolve it whenever the result is in;
					the ledger moves CB from losers to winners. Payouts and losses must balance, or we
					refuse to settle.
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle level={2}>No real money</CardTitle>
				</CardHeader>
				<CardContent class="text-muted-foreground">
					Crub Bucks have no real-world value. Don't try to send people USD via the app, don't
					try to redeem CB for anything tangible, and please don't get any of your friends
					arrested over a poker debt.
				</CardContent>
			</Card>
		</section>

		<Separator class="my-10" />

		<section class="text-center">
			<h2 class="text-2xl font-semibold tracking-tight">Ready to play?</h2>
			<p class="mt-2 text-muted-foreground">It takes about a minute to set up.</p>
			<div class="mt-6 flex justify-center gap-3">
				{#if data.user}
					<Button size="lg" href="/app">Go to dashboard</Button>
				{:else}
					<Button size="lg" href="/register">Create an account</Button>
					<Button size="lg" variant="outline" href="/login">I have an account</Button>
				{/if}
			</div>
		</section>
	</main>

	<footer class="mt-16 border-t">
		<div
			class="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-6 text-sm text-muted-foreground"
		>
			<div>Crub Bucks · closed-loop play currency</div>
			<div class="flex gap-4">
				<a href="/" class="hover:text-foreground">Home</a>
				<a href="/about" class="hover:text-foreground">About</a>
				{#if !data.user}
					<a href="/login" class="hover:text-foreground">Log in</a>
				{/if}
			</div>
		</div>
	</footer>
</div>
