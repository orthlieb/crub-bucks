<script lang="ts">
	import { onMount } from 'svelte';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import { Button } from '$lib/components/ui/button';
	import {
		isCashSoundEnabled,
		setCashSoundEnabled,
		playCashSound,
		warmUpCashSound
	} from '$lib/sound';

	// Default on; resolved from localStorage after mount to avoid SSR mismatch.
	let enabled = $state(true);

	onMount(() => {
		enabled = isCashSoundEnabled();
		warmUpCashSound();
	});

	function toggle() {
		enabled = !enabled;
		setCashSoundEnabled(enabled);
		// Turning it on plays a quick preview — doubles as the user gesture that
		// unlocks audio playback for the cha-ching cue.
		if (enabled) playCashSound();
	}

	const label = $derived(enabled ? 'Sound on' : 'Sound off');
</script>

<Button
	variant="ghost"
	size="icon"
	onclick={toggle}
	aria-label={`Cha-ching ${enabled ? 'on' : 'off'} (click to toggle)`}
	title={label}
>
	{#if enabled}
		<Volume2 />
	{:else}
		<VolumeX />
	{/if}
</Button>
