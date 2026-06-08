<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
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
	import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_DISTINCT } from '$lib/auth/password-policy';

	let { form, data }: { form: ActionData; data: PageData } = $props();

	// Either condition prevents new accounts. Both disable the fields and the
	// submit button so visitors don't waste time filling things in.
	const signupBlocked = $derived(data.registrationLocked || data.registrationFullToday);

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
				<CardTitle level={1}>Create your account</CardTitle>
				<CardDescription>We'll send a verification link before you can log in.</CardDescription>
			</CardHeader>

			<CardContent>
				{#if data.registrationLocked}
					<Alert variant="destructive" class="mb-4">
						<AlertDescription>
							{data.registrationLockMessage ||
								'Registration is currently closed. Please check back later.'}
						</AlertDescription>
					</Alert>
				{:else if data.registrationFullToday}
					<Alert variant="destructive" class="mb-4">
						<AlertDescription>
							{data.registrationFullTodayMessage}
						</AlertDescription>
					</Alert>
				{/if}

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
					<!-- Ties this signup back to the invite even if the email differs. -->
					{#if data.prefillInvite}
						<input type="hidden" name="invite" value={data.prefillInvite} />
					{/if}
					<div class="space-y-2">
						<Label for="displayName">Display name</Label>
						<Input
							id="displayName"
							name="displayName"
							autocomplete="nickname"
							required
							maxlength={40}
							value={form?.displayName ?? ''}
							disabled={signupBlocked}
						/>
					</div>

					<div class="space-y-2">
						<Label for="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							required
							value={form?.email ?? data.prefillEmail ?? ''}
							disabled={signupBlocked}
						/>
					</div>

					<div class="space-y-2">
						<Label for="password">Password</Label>
						<Input
							id="password"
							name="password"
							type="password"
							autocomplete="new-password"
							required
							disabled={signupBlocked}
						/>
						<p class="text-xs text-muted-foreground">
							At least {PASSWORD_MIN_LENGTH} characters with {PASSWORD_MIN_DISTINCT} different characters.
						</p>
					</div>

					<Captcha bind:token={captchaToken} bind:reset={resetCaptcha} />

					<Button type="submit" class="w-full" disabled={signupBlocked || !captchaToken}>
						Create account
					</Button>
					{#if !signupBlocked && !captchaToken}
						<p class="text-center text-xs text-muted-foreground">
							Complete the captcha to continue.
						</p>
					{/if}
				</form>
			</CardContent>

			<CardFooter class="justify-center text-sm text-muted-foreground">
				Already have one?&nbsp;<a href="/login" class="font-medium text-primary hover:underline"
					>Log in</a
				>
			</CardFooter>
		</Card>
	</div>
</div>
