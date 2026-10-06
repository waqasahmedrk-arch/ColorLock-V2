// Notification sounds, synthesised with Web Audio (no audio files to ship or cache).
//
// The on/off switch is saved to the account (/notifications/preferences, `sound`) and mirrored
// here so every component reads it synchronously. Browsers only let a page make sound after
// the user has interacted with it, so the AudioContext is unlocked on the first click or key.

export type Chime = "notification" | "message";

export const SOUND_CHANGED = "colorlock:sound-changed";
const KEY = "cl_sound";
// A notification and the chat reply that caused it arrive together; one sound covers both.
const DEDUPE_MS = 2500;

let enabled = readCached();
let ctx: AudioContext | null = null;
let lastPlayed = 0;

function readCached(): boolean {
  try {
    return typeof window === "undefined" || localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

// Called with the server's value on load, and by the toggles after saving.
export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the setting still holds for this page, and the account keeps it.
  }
  window.dispatchEvent(new CustomEvent(SOUND_CHANGED, { detail: { on } }));
}

function context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

// Installs the one-time unlock; safe to call from several components.
let unlockInstalled = false;
export function installAudioUnlock() {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;
  const unlock = () => {
    context()?.resume().catch(() => undefined);
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function tone(ac: AudioContext, freq: number, start: number, length: number, volume: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

// `force` plays even when switched off (the "test sound" button).
export function playChime(kind: Chime = "notification", force = false) {
  if (!enabled && !force) return;
  const now = Date.now();
  if (!force && now - lastPlayed < DEDUPE_MS) return;
  const ac = context();
  if (!ac || ac.state !== "running") {
    // Not unlocked yet (no interaction on this page): try, and stay silent if refused.
    ac?.resume().catch(() => undefined);
    if (!ac || ac.state !== "running") return;
  }
  lastPlayed = now;
  const t = ac.currentTime + 0.01;
  if (kind === "message") {
    // A soft two-step "pop": quick and low, for chat replies.
    tone(ac, 660, t, 0.14, 0.12);
    tone(ac, 990, t + 0.08, 0.22, 0.1);
  } else {
    // A bright three-note chime (E6, G#6, B6 arpeggio).
    tone(ac, 1318.5, t, 0.35, 0.09);
    tone(ac, 1661.2, t + 0.09, 0.35, 0.08);
    tone(ac, 1975.5, t + 0.18, 0.5, 0.07);
  }
}
