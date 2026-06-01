<script lang="ts" module>
	// Deterministic hue from a string, so a given user always gets the same
	// colour for their initials avatar across the app.
	function hueFromString(s: string): number {
		let h = 0;
		for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
		return h % 360;
	}

	function initialsOf(name: string): string {
		const parts = name.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		id,
		name,
		avatarUpdatedAt = null,
		size = 32,
		class: className
	}: {
		id: string;
		name: string;
		/** Set when the user has an uploaded photo; also cache-busts the URL. */
		avatarUpdatedAt?: Date | string | null;
		size?: number;
		class?: string;
	} = $props();

	// Fall back to initials if the image fails to load (deleted mid-session, etc.).
	let imgFailed = $state(false);

	const version = $derived(avatarUpdatedAt ? new Date(avatarUpdatedAt).getTime() : null);
	const showImg = $derived(version !== null && !imgFailed);
	const hue = $derived(hueFromString(id || name));
	const initials = $derived(initialsOf(name));
</script>

<span
	class={cn(
		'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium text-white select-none',
		className
	)}
	style={`width:${size}px;height:${size}px;${showImg ? '' : `background-color:hsl(${hue} 55% 45%);`}`}
	aria-label={name}
	title={name}
>
	{#if showImg}
		<img
			src={`/app/avatar/${id}?v=${version}`}
			alt={name}
			width={size}
			height={size}
			class="h-full w-full object-cover"
			loading="lazy"
			onerror={() => (imgFailed = true)}
		/>
	{:else}
		<span style={`font-size:${Math.round(size * 0.4)}px`}>{initials}</span>
	{/if}
</span>
