<script lang="ts">
	import { onMount } from 'svelte';
	import Bell from '@lucide/svelte/icons/bell';
	import BellOff from '@lucide/svelte/icons/bell-off';
	import { Button } from '$lib/components/ui/button';
	import {
		pushSupported,
		isStandalone,
		isSubscribed,
		enablePush,
		disablePush
	} from '$lib/push-client';

	let supported = $state(true);
	let enabled = $state(false);
	let busy = $state(false);
	// Reason the toggle is unavailable, if any.
	let blocked = $state<'' | 'install' | 'denied' | 'unsupported'>('');

	onMount(async () => {
		supported = pushSupported();
		if (!supported) {
			const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
			blocked = ios && !isStandalone() ? 'install' : 'unsupported';
			return;
		}
		if (Notification.permission === 'denied') blocked = 'denied';
		enabled = await isSubscribed();
	});

	async function toggle() {
		if (busy) return;
		busy = true;
		try {
			if (enabled) {
				await disablePush();
				enabled = false;
			} else {
				const result = await enablePush();
				if (result === 'subscribed') {
					enabled = true;
					blocked = '';
				} else if (result === 'denied') {
					blocked = 'denied';
				} else {
					blocked = 'unsupported';
				}
			}
		} finally {
			busy = false;
		}
	}

	const hint = $derived(
		blocked === 'install'
			? 'Install app first'
			: blocked === 'denied'
				? 'Blocked in browser'
				: blocked === 'unsupported'
					? 'Not supported'
					: ''
	);
</script>

{#if supported && blocked !== 'denied'}
	<Button
		variant="ghost"
		size="icon"
		onclick={toggle}
		disabled={busy}
		aria-label={`Notifications ${enabled ? 'on' : 'off'} (click to toggle)`}
		title={enabled ? 'Notifications on' : 'Notifications off'}
	>
		{#if enabled}
			<Bell />
		{:else}
			<BellOff />
		{/if}
	</Button>
{:else}
	<span class="text-xs text-muted-foreground">{hint}</span>
{/if}
