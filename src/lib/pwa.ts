/**
 * Client-only PWA install helpers. Call these from onMount / event handlers —
 * they touch `window`/`navigator` and must not run during SSR.
 */

/** True when the app is already running as an installed PWA (standalone). */
export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	const displayMode = window.matchMedia?.('(display-mode: standalone)').matches ?? false;
	// iOS Safari exposes its own standalone flag instead of display-mode.
	const iosStandalone = (navigator as unknown as { standalone?: boolean }).standalone === true;
	return displayMode || iosStandalone;
}

/** True on iOS/iPadOS, where there's no `beforeinstallprompt` and the user must
 *  add to the home screen manually via the Share sheet. */
export function isIOS(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	if (/iphone|ipad|ipod/i.test(ua)) return true;
	// iPadOS 13+ reports as desktop Safari — sniff a touch-capable Mac.
	return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
}
