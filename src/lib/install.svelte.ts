import { isStandalone } from './pwa';

/**
 * App-wide install state. The browser fires `beforeinstallprompt` once, early in
 * page load — long before the Settings dialog mounts — so we capture it here at
 * the app shell and expose it reactively. Components read {@link installState}
 * and call {@link promptInstall} to fire the native installer.
 */

type BeforeInstallPromptEvent = Event & {
	prompt: () => void;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let deferred: BeforeInstallPromptEvent | null = null;
let initialized = false;

// `canPrompt`: the native install prompt is available (Android / desktop Chromium).
// `installed`: running as an installed PWA (standalone).
const state = $state({ canPrompt: false, installed: false });

/** Start listening for install events. Call once, client-side (the app shell). */
export function initInstall(): void {
	if (initialized || typeof window === 'undefined') return;
	initialized = true;
	state.installed = isStandalone();
	window.addEventListener('beforeinstallprompt', (e) => {
		e.preventDefault();
		deferred = e as BeforeInstallPromptEvent;
		state.canPrompt = true;
	});
	window.addEventListener('appinstalled', () => {
		state.installed = true;
		state.canPrompt = false;
		deferred = null;
	});
}

/** Reactive install state shared across components. */
export function installState() {
	return state;
}

/** Fire the browser's native install prompt (no-op where unavailable). */
export async function promptInstall(): Promise<void> {
	if (!deferred) return;
	deferred.prompt();
	try {
		await deferred.userChoice;
	} catch {
		/* user dismissed the native dialog */
	}
	deferred = null;
	state.canPrompt = false;
}
