<script lang="ts" module>
	// Coloured status ring around the avatar. Driven by the user's relationship
	// to a bet: acceptance (pending), outcome (resolved), or who cancelled it.
	export type AvatarRing = 'green' | 'yellow' | 'red' | null;

	const RINGS: Record<'green' | 'yellow' | 'red', string> = {
		green: 'ring-2 ring-success',
		yellow: 'ring-2 ring-yellow-400',
		red: 'ring-2 ring-destructive'
	};

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
		ring = null,
		size = 32,
		class: className
	}: {
		id: string;
		name: string;
		/** Set when the user has an uploaded photo; also cache-busts the URL. */
		avatarUpdatedAt?: Date | string | null;
		/** Coloured status ring (bet acceptance / outcome / cancellation). */
		ring?: AvatarRing;
		size?: number;
		class?: string;
	} = $props();

	// Fall back to initials if the image fails to load (deleted mid-session, etc.).
	let imgFailed = $state(false);

	const version = $derived(avatarUpdatedAt ? new Date(avatarUpdatedAt).getTime() : null);
	const showImg = $derived(version !== null && !imgFailed);
	const initials = $derived(initialsOf(name));
</script>

<span
	class={cn(
		'inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-medium text-primary-foreground select-none',
		ring && RINGS[ring],
		className
	)}
	style={`width:${size}px;height:${size}px;${
		showImg ? 'background-color:oklch(0.72 0.15 293);' : ''
	}`}
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
