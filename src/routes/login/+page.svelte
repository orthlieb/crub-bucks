<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData } from './$types';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Card,
		CardContent,
		CardDescription,
		CardFooter,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Alert, AlertDescription } from '$lib/components/ui/alert';
	import Captcha from '$lib/components/Captcha.svelte';

	let { form }: { form: ActionData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background py-12 px-4">
	<div class="mx-auto max-w-md">
		<a href="/" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
			<span>Crub Bucks</span>
		</a>

		<Card>
			<CardHeader>
				<CardTitle level={1}>Welcome back</CardTitle>
				<CardDescription>Log in to your account.</CardDescription>
			</CardHeader>

			<CardContent>
				{#if form?.error}
					<Alert variant="destructive" class="mb-4">
						<AlertDescription>{form.error}</AlertDescription>
					</Alert>
				{/if}

				<form method="POST" use:enhance class="space-y-4">
					<div class="space-y-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							required
							value={form?.email ?? ''}
						/>
					</div>

					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<Label for="password">Password</Label>
							<a href="/forgot-password" class="text-xs text-muted-foreground hover:text-primary hover:underline">
								Forgot?
							</a>
						</div>
						<Input
							id="password"
							name="password"
							type="password"
							autocomplete="current-password"
							required
						/>
					</div>

					<Captcha />

					<Button type="submit" class="w-full">Log in</Button>
				</form>
			</CardContent>

			<CardFooter class="justify-center text-sm text-muted-foreground">
				New here?&nbsp;<a href="/register" class="font-medium text-primary hover:underline">Create an account</a>
			</CardFooter>
		</Card>
	</div>
</div>
