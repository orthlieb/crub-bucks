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

	// Gate submission on a solved captcha so the form can't be sent prematurely
	// (Enter key, autofill, or clicking before solving). resetCaptcha clears the
	// spent single-use token after a failed attempt.
	let captchaToken = $state('');
	let resetCaptcha = $state(() => {});
</script>

<div class="kibble-bg min-h-screen bg-background py-12 px-4">
	<div class="mx-auto max-w-md">
		<a href="/" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
			<span>Crub Bucks</span>
		</a>

		<!-- Cala greets returning users. Negative margin tucks her face just
		     above the card; rounded-full + ring + shadow lifts her off the
		     gradient. -->
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

				<form
					method="POST"
					use:enhance={() => {
						return async ({ result, update }) => {
							// Spent single-use token — reset so the next try gets a fresh one.
							if (result.type === 'failure') resetCaptcha();
							await update();
						};
					}}
					class="space-y-4"
				>
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

					<!-- Remember me. When checked the cookie persists across browser
					     restarts; when unchecked the browser drops it on close. -->
					<label class="flex cursor-pointer items-center gap-2 text-sm select-none">
						<input
							type="checkbox"
							name="remember"
							class="h-4 w-4 rounded border-input"
							checked={form?.remember ?? false}
						/>
						<span>Remember me on this device</span>
					</label>

					<Captcha bind:token={captchaToken} bind:reset={resetCaptcha} />

					<Button type="submit" class="w-full" disabled={!captchaToken}>Log in</Button>
					{#if !captchaToken}
						<p class="text-center text-xs text-muted-foreground">Complete the captcha to continue.</p>
					{/if}
				</form>
			</CardContent>

			<CardFooter class="justify-center text-sm text-muted-foreground">
				New here?&nbsp;<a href="/register" class="font-medium text-primary hover:underline">Create an account</a>
			</CardFooter>
		</Card>
	</div>
</div>
