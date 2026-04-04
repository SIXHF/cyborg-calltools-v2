/**
 * Notification sounds — exact V1 parameters from calltools.html playTone() calls.
 * Uses Web Audio API OscillatorNode with exponential fade-out to avoid clicks.
 */

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Get notification preferences from localStorage */
export function getNotifSettings(): { dtmfSound: boolean; callEvents: boolean; desktop: boolean } {
  try {
    const raw = localStorage.getItem('ct2_notif_settings');
    if (raw) return JSON.parse(raw);
  } catch {}
  return { dtmfSound: true, callEvents: false, desktop: false };
}

/** Save notification preferences */
export function saveNotifSettings(settings: { dtmfSound: boolean; callEvents: boolean; desktop: boolean }) {
  localStorage.setItem('ct2_notif_settings', JSON.stringify(settings));
}

/** Play a tone with exponential fade-out (V1 parity) */
function playTone(freq: number, duration: number, volume: number) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.value = volume;
    // V1: exponentialRampToValueAtTime for smooth fade-out (avoids clicks)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

/** DTMF beep — V1: playTone(1200, 0.08, 0.12) */
export function notifDtmfBeep() {
  if (!getNotifSettings().dtmfSound) return;
  playTone(1200, 0.08, 0.12);
}

/** Call connect — V1: playTone(600, 0.15, 0.15) then playTone(900, 0.15, 0.15) after 160ms */
export function notifCallConnect() {
  if (!getNotifSettings().callEvents) return;
  playTone(600, 0.15, 0.15);
  setTimeout(() => playTone(900, 0.15, 0.15), 160);
}

/** Call hangup — V1: playTone(500, 0.2, 0.12) then playTone(350, 0.25, 0.12) after 220ms */
export function notifCallHangup() {
  if (!getNotifSettings().callEvents) return;
  playTone(500, 0.2, 0.12);
  setTimeout(() => playTone(350, 0.25, 0.12), 220);
}

/** Broadcast alert — V1: playTone(800, 0.15, 0.15) then playTone(1000, 0.15, 0.15) after 170ms */
export function notifBroadcast() {
  playTone(800, 0.15, 0.15);
  setTimeout(() => playTone(1000, 0.15, 0.15), 170);
}
