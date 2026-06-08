<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { env } from '$env/dynamic/public';

	let {
		theme = 'light',
		size = 'normal',
		token = $bindable(''),
		reset = $bindable(() => {})
	}: {
		theme?: 'light' | 'dark';
		size?: 'normal' | 'compact' | 'invisible';
		/** Bindable: the solved hCaptcha token (empty until solved/after expiry).
		 *  Parents gate their submit button on this so the form can't be sent
		 *  before the captcha is solved. */
		token?: string;
		/** Bindable: call to reset the widget (e.g. after a failed submit — the
		 *  token is single-use, so the next attempt needs a fresh one). */
		reset?: () => void;
	} = $props();

	const siteKey = env.PUBLIC_HCAPTCHA_SITE_KEY ?? '';

	type HCaptcha = {
		render: (el: HTMLElement, opts: Record<string, unknown>) => string;
		reset: (id?: string) => void;
		remove?: (id: string) => void;
	};
	// SSR-safe: Svelte runs onDestroy on the server too, and it calls getHc().
	// Touching `window` during SSR throws (ReferenceError: window is not defined)
	// and 500s the whole page, so guard the access.
	const getHc = (): HCaptcha | undefined =>
		typeof window === 'undefined'
			? undefined
			: (window as unknown as { hcaptcha?: HCaptcha }).hcaptcha;

	let container: HTMLDivElement | undefined = $state();
	let widgetId: string | undefined;
	let scriptLoaded = $state(false);

	function renderWidget() {
		const hc = getHc();
		if (!hc || !container || widgetId !== undefined) return;
		scriptLoaded = true;
		widgetId = hc.render(container, {
			sitekey: siteKey,
			theme,
			size,
			callback: (t: string) => (token = t),
			'expired-callback': () => (token = ''),
			'error-callback': () => (token = '')
		});
		reset = () => {
			token = '';
			const h = getHc();
			if (h && widgetId !== undefined) h.reset(widgetId);
		};
	}

	onMount(() => {
		// No site key (e.g. local dev): there's no widget to solve, so hand the
		// parent a sentinel token to keep its submit gate open.
		if (!siteKey) {
			token = 'unconfigured';
			return;
		}
		// Script may already be present from a previous page (SPA navigation).
		if (getHc()) {
			renderWidget();
			return;
		}
		const existing = document.querySelector<HTMLScriptElement>('script[data-hcaptcha]');
		if (existing) {
			existing.addEventListener('load', renderWidget);
			return () => existing.removeEventListener('load', renderWidget);
		}
		const s = document.createElement('script');
		// Explicit render (we call hcaptcha.render ourselves) so we get the
		// solved/expired callbacks that drive the submit gate.
		s.src = 'https://js.hcaptcha.com/1/api.js?render=explicit';
		s.async = true;
		s.defer = true;
		s.dataset.hcaptcha = 'true';
		s.onload = renderWidget;
		document.head.appendChild(s);
	});

	onDestroy(() => {
		const hc = getHc();
		if (hc?.remove && widgetId !== undefined) {
			try {
				hc.remove(widgetId);
			} catch {
				/* widget already gone */
			}
		}
	});
</script>

{#if siteKey}
	<div bind:this={container}></div>
	{#if !scriptLoaded}
		<p class="mt-1 text-xs text-muted-foreground">Loading captcha…</p>
	{/if}
{/if}
