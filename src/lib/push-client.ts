import { env } from '$env/dynamic/public';

/**
 * Client-side Web Push helpers: feature detection, permission + subscribe, and
 * unsubscribe. The service worker is auto-registered by SvelteKit.
 */

function urlBase64ToUint8Array(base64: string): Uint8Array {
	const padding = '='.repeat((4 - (base64.length % 4)) % 4);
	const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
	const raw = atob(b64);
	const out = new Uint8Array(raw.length);
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** True when this browser supports Web Push at all. */
export function pushSupported(): boolean {
	return (
		typeof window !== 'undefined' &&
		'serviceWorker' in navigator &&
		'PushManager' in window &&
		'Notification' in window
	);
}

/** True when the app is running as an installed PWA (required for iOS push). */
export function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		// iOS Safari legacy flag
		(navigator as unknown as { standalone?: boolean }).standalone === true
	);
}

/** Whether this device currently has an active push subscription. */
export async function isSubscribed(): Promise<boolean> {
	if (!pushSupported()) return false;
	const reg = await navigator.serviceWorker.ready;
	return (await reg.pushManager.getSubscription()) !== null;
}

export type EnableResult = 'subscribed' | 'denied' | 'unsupported';

/** Request permission, subscribe, and register the subscription server-side. */
export async function enablePush(): Promise<EnableResult> {
	if (!pushSupported() || !env.PUBLIC_VAPID_KEY) return 'unsupported';
	const permission = await Notification.requestPermission();
	if (permission !== 'granted') return 'denied';

	const reg = await navigator.serviceWorker.ready;
	const sub =
		(await reg.pushManager.getSubscription()) ??
		(await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(env.PUBLIC_VAPID_KEY) as BufferSource
		}));

	await fetch('/api/push/subscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(sub)
	});
	return 'subscribed';
}

/** Unsubscribe this device and drop the server-side record. */
export async function disablePush(): Promise<void> {
	if (!pushSupported()) return;
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (!sub) return;
	await fetch('/api/push/unsubscribe', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ endpoint: sub.endpoint })
	}).catch(() => {});
	await sub.unsubscribe().catch(() => {});
}
