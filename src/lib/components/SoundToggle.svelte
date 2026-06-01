<script lang="ts">
	import { onMount } from 'svelte';
	import Volume2 from '@lucide/svelte/icons/volume-2';
	import VolumeX from '@lucide/svelte/icons/volume-x';
	import { Button } from '$lib/components/ui/button';
	import { isSoundEnabled, setSoundEnabled, play, warmUpSound } from '$lib/sound';

	// Default on; resolved from localStorage after mount to avoid SSR mismatch.
	let enabled = $state(true);

	onMount(() => {
		enabled = isSoundEnabled();
		warmUpSound();
	});

	function toggle() {
		enabled = !enabled;
		setSoundEnabled(enabled);
		// Turning it on plays a quick preview — doubles as the user gesture that
		// unlocks audio playback for the cues.
		if (enabled) play('cash');
	}

	const label = $derived(enabled ? 'Sound on' : 'Sound off');
</script>

<Button
	variant="ghost"
	size="icon"
	onclick={toggle}
	aria-label={`Sound effects ${enabled ? 'on' : 'off'} (click to toggle)`}
	title={label}
>
	{#if enabled}
		<Volume2 />
	{:else}
		<VolumeX />
	{/if}
</Button>
