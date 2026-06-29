<script lang="ts">
	import { enhance } from '$app/forms';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import Share from '@lucide/svelte/icons/share-2';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	// The absolute /add/{qrToken} link for this user. Null only if the token
	// couldn't be loaded (shouldn't happen for a signed-in user).
	let { addUrl }: { addUrl: string | null } = $props();

	let qrOpen = $state(false);
	let qrDataUrl = $state('');
	let copied = $state(false);

	// Share the link: native share sheet → SMS (mobile) → clipboard copy.
	async function shareLink() {
		if (!addUrl) return;
		const text = `Add me on Crub Bucks: ${addUrl}`;
		if (navigator.share) {
			try {
				await navigator.share({ text, url: addUrl });
				return;
			} catch {
				return; // user cancelled the sheet
			}
		}
		const isMobile = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
		if (isMobile) {
			// Prefill an SMS with the link; the user picks the recipient.
			window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
			return;
		}
		try {
			await navigator.clipboard.writeText(addUrl);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			/* clipboard unavailable — the link is visible in the QR sheet to copy */
		}
	}

	// Render the QR client-side when the sheet opens (qrcode is ~build-heavy, so
	// it's dynamically imported and only loads on demand).
	async function renderQr() {
		if (!addUrl || qrDataUrl) return;
		try {
			const QRCode = (await import('qrcode')).default;
			qrDataUrl = await QRCode.toDataURL(addUrl, { width: 256, margin: 1 });
		} catch {
			qrDataUrl = '';
		}
	}

	function onQrOpenChange(open: boolean) {
		qrOpen = open;
		if (open) renderQr();
	}
</script>

<div class="flex flex-wrap gap-2">
	<Button variant="outline" class="flex-1 gap-1.5" disabled={!addUrl} onclick={shareLink}>
		<Share class="size-4" />
		{copied ? 'Link copied' : 'Text a link'}
	</Button>
	<Button
		variant="outline"
		class="flex-1 gap-1.5"
		disabled={!addUrl}
		onclick={() => onQrOpenChange(true)}
	>
		<QrCode class="size-4" />
		Show QR
	</Button>
</div>

<Dialog.Root bind:open={qrOpen} onOpenChange={onQrOpenChange}>
	<Dialog.Content class="max-w-xs">
		<Dialog.Title>Scan to add me</Dialog.Title>
		<div class="flex flex-col items-center gap-3 py-2">
			{#if qrDataUrl}
				<img src={qrDataUrl} alt="QR code linking to your add-friend page" class="size-56" />
			{:else}
				<div class="flex size-56 items-center justify-center text-sm text-muted-foreground">
					Generating…
				</div>
			{/if}
			<p class="text-center text-sm text-muted-foreground">
				Point your phone camera here — no app needed. Tap the link that pops up to add me.
			</p>
			<form method="POST" action="?/resetQr" use:enhance class="w-full">
				<Button
					type="submit"
					variant="ghost"
					size="sm"
					class="w-full gap-1.5 text-muted-foreground"
					onclick={(e: MouseEvent) => {
						if (!confirm('Reset your code? Any codes you already shared will stop working.')) {
							e.preventDefault();
						} else {
							// Force a re-render of the new code after the data refreshes.
							qrDataUrl = '';
						}
					}}
				>
					<RotateCcw class="size-4" />
					Reset QR
				</Button>
			</form>
		</div>
	</Dialog.Content>
</Dialog.Root>
