<script lang="ts">
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="kibble-bg min-h-screen bg-background py-12 px-4">
	<div class="mx-auto max-w-md">
		<a href="/" class="mb-6 flex items-center gap-2 font-semibold tracking-tight">
			<span class="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm">₡</span>
			<span>Crub Bucks</span>
		</a>

		<Card>
			<CardHeader>
				<CardTitle level={1}>Check your email</CardTitle>
				<CardDescription>
					We sent a verification link to the address you provided. Click the link to activate
					your account, then come back to log in.
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-3 text-sm text-muted-foreground">
				<p>
					The link expires in 1 hour. If it doesn't show up in a few minutes, check your spam
					folder.
				</p>
				<p>
					Wrong email? Just submit the form again with the right address — both attempts will
					produce a verification email.
				</p>
			</CardContent>
			<div class="px-6 pb-6 pt-0 flex gap-2">
				<Button variant="outline" href="/register">Try a different email</Button>
				<Button href="/login">Go to log in</Button>
			</div>
		</Card>
	</div>
</div>
