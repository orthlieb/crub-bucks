/**
 * Tiny Web Audio "cha-ching" cue, played when someone sends you money.
 *
 * The sound is synthesized on the fly (two ascending bell notes) rather than
 * shipped as an audio file — nothing to download, nothing to license, and it
 * works offline. Browsers gate audio behind a user gesture, so the AudioContext
 * is created lazily and resumed on the first interaction; if playback is still
 * blocked (e.g. a hard reload with no prior gesture) the call simply no-ops.
 */

// localStorage key for the user's mute preference. Absent / anything other than
// 'off' means enabled (sound on by default).
export const SOUND_PREF_KEY = 'cb:sound';

let ctx: AudioContext | null = null;
let warmedUp = false;

function getCtx(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	try {
		if (!ctx) {
			const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AC) return null;
			ctx = new AC();
		}
		return ctx;
	} catch {
		return null;
	}
}

/** Whether the cha-ching is enabled (default true). */
export function isCashSoundEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return localStorage.getItem(SOUND_PREF_KEY) !== 'off';
	} catch {
		return true;
	}
}

/** Persist the mute preference. */
export function setCashSoundEnabled(on: boolean): void {
	try {
		localStorage.setItem(SOUND_PREF_KEY, on ? 'on' : 'off');
	} catch {
		// ignore (private mode, etc.)
	}
}

/**
 * Register a one-time gesture listener that resumes the AudioContext, so the
 * first real cha-ching after some interaction is reliably audible. Safe to call
 * repeatedly; only the first call wires anything up.
 */
export function warmUpCashSound(): void {
	if (warmedUp || typeof window === 'undefined') return;
	warmedUp = true;
	const resume = () => {
		const c = getCtx();
		if (c && c.state === 'suspended') c.resume().catch(() => {});
	};
	window.addEventListener('pointerdown', resume, { once: true, passive: true });
	window.addEventListener('keydown', resume, { once: true });
}

/** One bell partial-stack with a fast attack and exponential decay. */
function bell(c: AudioContext, t0: number, freq: number, peak: number): void {
	const env = c.createGain();
	env.gain.setValueAtTime(0.0001, t0);
	env.gain.linearRampToValueAtTime(peak, t0 + 0.005);
	env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
	env.connect(c.destination);

	// A few inharmonic partials give it a metallic, cash-register ring.
	const partials = [1, 2.01, 3.0];
	const gains = [1, 0.5, 0.25];
	for (let i = 0; i < partials.length; i++) {
		const osc = c.createOscillator();
		osc.type = i === 0 ? 'triangle' : 'sine';
		osc.frequency.value = freq * partials[i];
		const g = c.createGain();
		g.gain.value = gains[i];
		osc.connect(g).connect(env);
		osc.start(t0);
		osc.stop(t0 + 0.5);
	}
}

/** Play the two-note "cha-ching". No-ops if audio is unavailable/blocked. */
export function playCashSound(): void {
	const c = getCtx();
	if (!c) return;
	if (c.state === 'suspended') c.resume().catch(() => {});
	const t = c.currentTime + 0.01;
	bell(c, t, 1244.51, 0.18); // D#6 — the "cha"
	bell(c, t + 0.11, 1661.22, 0.2); // G#6 — the "ching"
}
