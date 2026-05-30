<script lang="ts">
	import type { PageData } from './$types';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Alert, AlertTitle, AlertDescription } from '$lib/components/ui/alert';

	let { data }: { data: PageData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background py-12 px-4">
	<div class="mx-auto max-w-md">
		<a href="/" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
			<span>Crub Bucks</span>
		</a>

		{#if data.status === 'ok'}
			<Card>
				<CardHeader>
					<CardTitle level={1}>Email verified</CardTitle>
					<CardDescription>Your account is active. Log in to get started.</CardDescription>
				</CardHeader>
				<CardContent>
					<Alert variant="success">
						<AlertTitle>You're in.</AlertTitle>
						<AlertDescription>
							Your wallet has been provisioned and the bank is ready when you are.
						</AlertDescription>
					</Alert>
				</CardContent>
				<div class="px-6 pb-6 pt-0">
					<Button href="/login" class="w-full">Continue to log in</Button>
				</div>
			</Card>
		{:else}
			<Card>
				<CardHeader>
					<CardTitle level={1}>Verification failed</CardTitle>
					<CardDescription>
						This link is either invalid, expired, or has already been used.
					</CardDescription>
				</CardHeader>
				<CardContent class="text-sm text-muted-foreground">
					Re-register with the same email to get a fresh verification link, or use the
					password recovery flow if you've already set a password.
				</CardContent>
				<div class="px-6 pb-6 pt-0 flex gap-2">
					<Button variant="outline" href="/register">Re-register</Button>
					<Button href="/forgot-password">Recover account</Button>
				</div>
			</Card>
		{/if}
	</div>
</div>
