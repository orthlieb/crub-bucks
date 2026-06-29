<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import {
		Card,
		CardContent,
		CardDescription,
		CardFooter,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background px-4 py-12">
	<div class="mx-auto max-w-md">
		<a href="/app" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span
				class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-sm text-primary-foreground"
				>₡</span
			>
			<span>Crub Bucks</span>
		</a>

		<div class="relative z-10 -mb-12 flex justify-center">
			<img
				src="/cala-avatar.png"
				alt="Cala the dog, smiling."
				width="160"
				height="160"
				class="h-[7.5rem] w-[7.5rem] select-none rounded-full bg-background object-cover shadow-lg ring-4 ring-background"
			/>
		</div>

		<Card class="pt-12">
			{#if data.status === 'confirm'}
				<CardHeader>
					<CardTitle level={1}>Add {data.name}?</CardTitle>
					<CardDescription>
						You'll become friends right away — you can bet and send bucks. {data.name} gets a heads-up
						that you added them.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{#if form && 'message' in form}
						<Alert variant="destructive" class="mb-4">
							<AlertDescription>{form.message}</AlertDescription>
						</Alert>
					{/if}
					<form method="POST" action="?/confirm" use:enhance>
						<Button type="submit" class="w-full">Add {data.name}</Button>
					</form>
				</CardContent>
				<CardFooter class="justify-center">
					<a href="/app/friends" class="text-sm text-muted-foreground hover:text-foreground">
						Not now
					</a>
				</CardFooter>
			{:else if data.status === 'already'}
				<CardHeader>
					<CardTitle level={1}>You're already friends</CardTitle>
					<CardDescription>You and {data.name} are already connected.</CardDescription>
				</CardHeader>
				<CardFooter class="justify-center">
					<Button href="/app/friends">Go to Friends</Button>
				</CardFooter>
			{:else if data.status === 'self'}
				<CardHeader>
					<CardTitle level={1}>That's your code</CardTitle>
					<CardDescription>
						Show it to a friend to scan — they'll be able to add you.
					</CardDescription>
				</CardHeader>
				<CardFooter class="justify-center">
					<Button href="/app/friends">Back to Friends</Button>
				</CardFooter>
			{:else}
				<CardHeader>
					<CardTitle level={1}>Code not valid</CardTitle>
					<CardDescription>
						This add code has expired or was reset. Ask your friend to reopen
						<span class="font-medium">Friends → Show QR</span> and share it again.
					</CardDescription>
				</CardHeader>
				<CardFooter class="justify-center">
					<Button href="/app/friends" variant="outline">Go to Friends</Button>
				</CardFooter>
			{/if}
		</Card>
	</div>
</div>
