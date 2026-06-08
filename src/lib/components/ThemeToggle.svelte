<script lang="ts">
	import { onMount } from 'svelte';
	import Sun from '@lucide/svelte/icons/sun';
	import Moon from '@lucide/svelte/icons/moon';
	import Monitor from '@lucide/svelte/icons/monitor';
	import { Button } from '$lib/components/ui/button';

	type Mode = 'light' | 'dark' | 'system';

	let mode = $state<Mode>('system');
	let media: MediaQueryList | undefined;

	function systemPrefersDark(): boolean {
		return window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	// Resolve a mode to the actual dark/light and apply it to <html>.
	function apply(m: Mode) {
		const dark = m === 'dark' || (m === 'system' && systemPrefersDark());
		document.documentElement.classList.toggle('dark', dark);
	}

	function onSystemChange() {
		if (mode === 'system') apply('system');
	}

	onMount(() => {
		const stored = (localStorage.getItem('theme') as Mode | null) ?? 'system';
		mode = stored === 'light' || stored === 'dark' ? stored : 'system';
		media = window.matchMedia('(prefers-color-scheme: dark)');
		media.addEventListener('change', onSystemChange);
		return () => media?.removeEventListener('change', onSystemChange);
	});

	// Cycle: light → dark → system → light
	function cycle() {
		mode = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
		try {
			localStorage.setItem('theme', mode);
		} catch {
			// ignore (private mode, etc.)
		}
		apply(mode);
	}

	const label = $derived(mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'System');
</script>

<Button
	variant="ghost"
	size="icon"
	onclick={cycle}
	aria-label={`Theme: ${label} (click to change)`}
	title={`Theme: ${label}`}
>
	{#if mode === 'light'}
		<Sun />
	{:else if mode === 'dark'}
		<Moon />
	{:else}
		<Monitor />
	{/if}
</Button>
