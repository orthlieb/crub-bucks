/**
 * App sound effects. Each named cue plays from a file in /sounds/<name>.mp3 if
 * present (drop in your own — e.g. Pixabay clips), otherwise a synthesized Web
 * Audio fallback plays so things work with no assets shipped. All cues respect
 * the user's on/off preference and the browser's autoplay-gesture requirement.
 *
 * Cues:
 *   cash   — gained CB (cash register)
 *   slide  — lost CB (slide whistle)
 *   hello  — friend request received ("hello there"; spoken fallback)
 *   yes    — a bet you're in went live
 *   no     — a bet you're in was called off
 */

export const SOUND_PREF_KEY = 'cb:sound';

export type SoundName = 'cash' | 'slide' | 'hello' | 'yes' | 'no' | 'wow';

// Optional override files. If one 404s (or can't decode) we remember that and
// use the synth fallback from then on.
const FILES: Record<SoundName, string> = {
	cash: '/sounds/cash-register.mp3',
	slide: '/sounds/slide-whistle.mp3',
	hello: '/sounds/hello-there.mp3',
	yes: '/sounds/yes.mp3',
	no: '/sounds/no.mp3',
	wow: '/sounds/wow.mp3'
};

const fileMissing = new Set<SoundName>();

let ctx: AudioContext | null = null;
let warmedUp = false;

function getCtx(): AudioContext | null {
	if (typeof window === 'undefined') return null;
	try {
		if (!ctx) {
			const AC =
				window.AudioContext ??
				(window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
			if (!AC) return null;
			ctx = new AC();
		}
		return ctx;
	} catch {
		return null;
	}
}

/** Whether sound effects are enabled (default true). */
export function isSoundEnabled(): boolean {
	if (typeof window === 'undefined') return false;
	try {
		return localStorage.getItem(SOUND_PREF_KEY) !== 'off';
	} catch {
		return true;
	}
}

export function setSoundEnabled(on: boolean): void {
	try {
		localStorage.setItem(SOUND_PREF_KEY, on ? 'on' : 'off');
	} catch {
		// ignore (private mode, etc.)
	}
}

/** Resume the AudioContext on the first user gesture so cues are audible. */
export function warmUpSound(): void {
	if (warmedUp || typeof window === 'undefined') return;
	warmedUp = true;
	const resume = () => {
		const c = getCtx();
		if (c && c.state === 'suspended') c.resume().catch(() => {});
	};
	window.addEventListener('pointerdown', resume, { once: true, passive: true });
	window.addEventListener('keydown', resume, { once: true });
}

/** Play a named cue (file if available, else synth). No-op if disabled. */
export function play(name: SoundName): void {
	if (!isSoundEnabled() || typeof window === 'undefined') return;
	if (fileMissing.has(name)) {
		synth(name);
		return;
	}
	try {
		const audio = new Audio(FILES[name]);
		audio.volume = 0.5;
		const p = audio.play();
		if (p && typeof p.catch === 'function') {
			p.catch(() => {
				// Missing/blocked file → remember and fall back to synth.
				fileMissing.add(name);
				synth(name);
			});
		}
	} catch {
		fileMissing.add(name);
		synth(name);
	}
}

// ---------------------------------------------------------------------------
// Synthesized fallbacks
// ---------------------------------------------------------------------------

function synth(name: SoundName): void {
	const c = getCtx();
	if (!c) return;
	if (c.state === 'suspended') c.resume().catch(() => {});
	const t = c.currentTime + 0.01;
	switch (name) {
		case 'cash':
			cashRegister(c, t);
			break;
		case 'slide':
			slideWhistle(c, t);
			break;
		case 'yes':
			twoNote(c, t, 659.25, 987.77, 'triangle'); // E5 → B5, rising = good
			break;
		case 'no':
			buzzer(c, t);
			break;
		case 'hello':
			helloThere(c, t);
			break;
		case 'wow':
			fanfare(c, t);
			break;
	}
}

/** A short triumphant arpeggio — the award fanfare. */
function fanfare(c: AudioContext, t0: number): void {
	const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 → E5 → G5 → C6
	notes.forEach((f, i) => bell(c, t0 + i * 0.09, f, 0.16));
}

/** A bell partial-stack with fast attack + exponential decay. */
function bell(c: AudioContext, t0: number, freq: number, peak: number): void {
	const env = c.createGain();
	env.gain.setValueAtTime(0.0001, t0);
	env.gain.linearRampToValueAtTime(peak, t0 + 0.005);
	env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.45);
	env.connect(c.destination);
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

/** Cash register: two ascending bright bells (the "cha-ching"). */
function cashRegister(c: AudioContext, t0: number): void {
	bell(c, t0, 1244.51, 0.18); // D#6
	bell(c, t0 + 0.11, 1661.22, 0.2); // G#6
}

/** Slide whistle: a tone gliding downward (the classic "wah-wah" of a loss). */
function slideWhistle(c: AudioContext, t0: number): void {
	const osc = c.createOscillator();
	osc.type = 'sine';
	const lp = c.createBiquadFilter();
	lp.type = 'lowpass';
	lp.frequency.value = 2400;
	const env = c.createGain();
	env.gain.setValueAtTime(0.0001, t0);
	env.gain.linearRampToValueAtTime(0.22, t0 + 0.02);
	env.gain.setValueAtTime(0.22, t0 + 0.34);
	env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
	osc.frequency.setValueAtTime(1200, t0);
	osc.frequency.exponentialRampToValueAtTime(320, t0 + 0.5);
	osc.connect(env).connect(lp).connect(c.destination);
	osc.start(t0);
	osc.stop(t0 + 0.6);
}

/** Two clean notes in sequence (used for the rising "yes"). */
function twoNote(
	c: AudioContext,
	t0: number,
	f1: number,
	f2: number,
	type: OscillatorType
): void {
	const blip = (t: number, f: number) => {
		const osc = c.createOscillator();
		osc.type = type;
		osc.frequency.value = f;
		const env = c.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.linearRampToValueAtTime(0.2, t + 0.01);
		env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
		osc.connect(env).connect(c.destination);
		osc.start(t);
		osc.stop(t + 0.24);
	};
	blip(t0, f1);
	blip(t0 + 0.13, f2);
}

/** Descending double "bewp-bewp" buzzer for a cancelled bet. */
function buzzer(c: AudioContext, t0: number): void {
	const blip = (t: number, f: number) => {
		const osc = c.createOscillator();
		osc.type = 'square';
		osc.frequency.setValueAtTime(f, t);
		osc.frequency.exponentialRampToValueAtTime(f * 0.7, t + 0.16);
		const env = c.createGain();
		env.gain.setValueAtTime(0.0001, t);
		env.gain.linearRampToValueAtTime(0.14, t + 0.01);
		env.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
		osc.connect(env).connect(c.destination);
		osc.start(t);
		osc.stop(t + 0.2);
	};
	blip(t0, 311.13); // D#4
	blip(t0 + 0.2, 233.08); // A#3 (lower = sadder)
}

/** Friendly greeting: speak "Hello there" if we can, else a ding-dong chime. */
function helloThere(c: AudioContext, t0: number): void {
	try {
		const synthApi = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
		if (synthApi) {
			const u = new SpeechSynthesisUtterance('Hello there');
			u.rate = 1;
			u.pitch = 1.1;
			u.volume = 0.7;
			synthApi.cancel();
			synthApi.speak(u);
			return;
		}
	} catch {
		// fall through to the chime
	}
	bell(c, t0, 659.25, 0.18); // E5 (ding)
	bell(c, t0 + 0.18, 523.25, 0.18); // C5 (dong)
}
