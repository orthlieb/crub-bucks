<script lang="ts">
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import { isStandalone, isIOS } from '$lib/pwa';
	import Share from '@lucide/svelte/icons/share';
	import Download from '@lucide/svelte/icons/download';
	import X from '@lucide/svelte/icons/x';

	// The Chromium install event, fired before the browser shows its own prompt.
	type InstallEvent = Event & { prompt: () => void; userChoice: Promise<unknown> };

	const DISMISS_KEY = 'cb-install-dismissed';

	let visible = $state(false);
	let mode = $state<'android' | 'ios'>('android');
	let deferred: InstallEvent | null = null;

	onMount(() => {
		// Already installed, or the user dismissed this before → stay quiet.
		if (isStandalone()) return;
		try {
			if (localStorage.getItem(DISMISS_KEY)) return;
		} catch {
			/* storage blocked — fall through and just show it */
		}

		// Android / desktop Chromium: capture the native prompt and offer a button.
		const onBeforeInstall = (e: Event) => {
			e.preventDefault();
			deferred = e as InstallEvent;
			mode = 'android';
			visible = true;
		};
		const onInstalled = () => {
			visible = false;
		};
		window.addEventListener('beforeinstallprompt', onBeforeInstall);
		window.addEventListener('appinstalled', onInstalled);

		// iOS Safari never fires that event — show the Share-sheet hint instead.
		if (isIOS()) {
			mode = 'ios';
			visible = true;
		}

		return () => {
			window.removeEventListener('beforeinstallprompt', onBeforeInstall);
			window.removeEventListener('appinstalled', onInstalled);
		};
	});

	async function install() {
		if (!deferred) return;
		deferred.prompt();
		try {
			await deferred.userChoice;
		} catch {
			/* user dismissed the native dialog */
		}
		deferred = null;
		visible = false;
	}

	function dismiss() {
		try {
			localStorage.setItem(DISMISS_KEY, '1');
		} catch {
			/* ignore */
		}
		visible = false;
	}
</script>

{#if visible}
	<div class="mb-6 flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
		<div
			class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"
		>
			<Download class="size-5" />
		</div>
		<div class="min-w-0 flex-1 text-sm">
			<div class="font-medium">Install Crub Bucks</div>
			{#if mode === 'ios'}
				<p class="text-muted-foreground">
					Tap
					<span class="inline-flex items-center gap-1 font-medium text-foreground">
						Share <Share class="inline size-4" />
					</span>, then <span class="font-medium text-foreground">Add to Home Screen</span>.
				</p>
			{:else}
				<p class="text-muted-foreground">
					Add it to your home screen for a full-screen, app-like experience.
				</p>
				<Button size="sm" class="mt-2" onclick={install}>Install app</Button>
			{/if}
		</div>
		<button
			type="button"
			onclick={dismiss}
			aria-label="Dismiss"
			class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		>
			<X class="size-4" />
		</button>
	</div>
{/if}
