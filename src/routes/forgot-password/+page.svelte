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
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import Captcha from '$lib/components/Captcha.svelte';

	let { form }: { form: ActionData } = $props();

	// Gate submission on a solved captcha (see login). resetCaptcha clears the
	// spent single-use token after a failed attempt.
	let captchaToken = $state('');
	let resetCaptcha = $state(() => {});
</script>

<div class="kibble-bg min-h-screen bg-background py-12 px-4">
	<div class="mx-auto max-w-md">
		<a href="/" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span
				class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm"
				>₡</span
			>
			<span>Crub Bucks</span>
		</a>

		<Card>
			<CardHeader>
				<CardTitle level={1}>Reset your password</CardTitle>
				<CardDescription>
					Enter your email and we'll send a reset link if there's an account on file.
				</CardDescription>
			</CardHeader>

			<CardContent>
				{#if form?.submitted}
					<Alert variant="success">
						<AlertTitle>Check your email.</AlertTitle>
						<AlertDescription>
							If there's an account associated with that address, a password reset link is on its
							way. The link expires in 1 hour.
						</AlertDescription>
					</Alert>
				{:else}
					{#if form?.error}
						<Alert variant="destructive" class="mb-4">
							<AlertDescription>{form.error}</AlertDescription>
						</Alert>
					{/if}

					<form
						method="POST"
						use:enhance={() => {
							return async ({ result, update }) => {
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

						<Captcha bind:token={captchaToken} bind:reset={resetCaptcha} />

						<Button type="submit" class="w-full" disabled={!captchaToken}>Send reset link</Button>
						{#if !captchaToken}
							<p class="text-center text-xs text-muted-foreground">
								Complete the captcha to continue.
							</p>
						{/if}
					</form>
				{/if}
			</CardContent>

			<CardFooter class="justify-center text-sm text-muted-foreground">
				<a href="/login" class="font-medium text-primary hover:underline">Back to log in</a>
			</CardFooter>
		</Card>
	</div>
</div>
