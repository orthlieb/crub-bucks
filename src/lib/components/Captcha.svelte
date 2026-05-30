<script lang="ts">
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';

	let {
		theme = 'light',
		size = 'normal'
	}: { theme?: 'light' | 'dark'; size?: 'normal' | 'compact' | 'invisible' } = $props();

	const siteKey = env.PUBLIC_HCAPTCHA_SITE_KEY ?? '';
	let scriptLoaded = $state(false);

	onMount(() => {
		if (!siteKey) return;
		if (document.querySelector('script[data-hcaptcha]')) {
			scriptLoaded = true;
			return;
		}
		const s = document.createElement('script');
		s.src = 'https://js.hcaptcha.com/1/api.js';
		s.async = true;
		s.defer = true;
		s.dataset.hcaptcha = 'true';
		s.onload = () => (scriptLoaded = true);
		document.head.appendChild(s);
	});
</script>

{#if siteKey}
	<div class="h-captcha" data-sitekey={siteKey} data-theme={theme} data-size={size}></div>
	{#if !scriptLoaded}
		<p class="mt-1 text-xs text-muted-foreground">Loading captcha…</p>
	{/if}
{/if}
