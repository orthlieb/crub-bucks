/// <reference types="@sveltejs/kit" />
/// <reference lib="webworker" />

// Push-only service worker (no offline caching — see docs/push-notifications.md).
const sw = self as unknown as ServiceWorkerGlobalScope;

// Activate immediately so push works on first subscribe without a reload.
sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (event) => event.waitUntil(sw.clients.claim()));

// A no-op fetch handler. We do NO offline caching, so every request falls
// through to the network untouched — but Chromium only treats the app as
// installable (and fires `beforeinstallprompt`) when the active service worker
// has a fetch handler at all. Its mere presence is what unlocks the one-tap
// Install affordance on desktop Chrome/Edge and Android; don't remove it.
sw.addEventListener('fetch', () => {});

interface PushPayload {
	title?: string;
	body?: string;
	url?: string;
	icon?: string;
	tag?: string;
}

sw.addEventListener('push', (event) => {
	let data: PushPayload = {};
	try {
		data = event.data?.json() ?? {};
	} catch {
		data = { title: event.data?.text() };
	}
	const title = data.title || 'Crub Bucks';
	event.waitUntil(
		sw.registration.showNotification(title, {
			body: data.body,
			icon: data.icon || '/icon-192.png',
			badge: '/icon-192.png',
			tag: data.tag,
			data: { url: data.url || '/app' }
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = (event.notification.data?.url as string) || '/app';
	event.waitUntil(
		(async () => {
			const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
			for (const client of windows) {
				if ('focus' in client) {
					await client.navigate(url).catch(() => {});
					return client.focus();
				}
			}
			return sw.clients.openWindow(url);
		})()
	);
});
