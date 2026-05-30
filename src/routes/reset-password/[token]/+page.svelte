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
	import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_DISTINCT } from '$lib/auth/password-policy';

	let { form, data }: { form: ActionData; data: PageData } = $props();
</script>

<div class="kibble-bg min-h-screen bg-background py-12 px-4">
	<div class="mx-auto max-w-md">
		<a href="/" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
			<span>Crub Bucks</span>
		</a>

		<Card>
			<CardHeader>
				<CardTitle level={1}>Choose a new password</CardTitle>
				<CardDescription>
					Pick something you don't use anywhere else. Existing sessions will be revoked.
				</CardDescription>
			</CardHeader>

			<CardContent>
				{#if !data.tokenValid}
					<Alert variant="destructive">
						<AlertDescription>
							This reset link is invalid, expired, or already used. Request a new one.
						</AlertDescription>
					</Alert>
				{:else}
					{#if form?.error}
						<Alert variant="destructive" class="mb-4">
							<AlertDescription>{form.error}</AlertDescription>
						</Alert>
					{/if}

					<form method="POST" use:enhance class="space-y-4">
						<div class="space-y-2">
							<Label for="password">New password</Label>
							<Input
								id="password"
								name="password"
								type="password"
								autocomplete="new-password"
								required
							/>
							<p class="text-xs text-muted-foreground">
								At least {PASSWORD_MIN_LENGTH} characters with {PASSWORD_MIN_DISTINCT} different characters.
							</p>
						</div>

						<div class="space-y-2">
							<Label for="confirmPassword">Confirm new password</Label>
							<Input
								id="confirmPassword"
								name="confirmPassword"
								type="password"
								autocomplete="new-password"
								required
							/>
						</div>

						<Button type="submit" class="w-full">Update password</Button>
					</form>
				{/if}
			</CardContent>

			<CardFooter class="justify-center text-sm text-muted-foreground">
				{#if !data.tokenValid}
					<a href="/forgot-password" class="font-medium text-primary hover:underline">Request a new link</a>
				{:else}
					<a href="/login" class="font-medium text-primary hover:underline">Back to log in</a>
				{/if}
			</CardFooter>
		</Card>
	</div>
</div>
