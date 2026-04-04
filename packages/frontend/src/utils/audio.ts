/**
 * Notification sounds matching V1's playTone() system.
 * Uses Web Audio API OscillatorNode.
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

/** Play a tone */
function playTone(freq: number, duration: number, volume = 0.1) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

/** DTMF beep sound (1200Hz, 50ms) */
export function notifDtmfBeep() {
  if (!getNotifSettings().dtmfSound) return;
  playTone(1200, 0.05, 0.08);
}

/** Call connect sound (600Hz + 900Hz, 150ms) */
export function notifCallConnect() {
  if (!getNotifSettings().callEvents) return;
  playTone(600, 0.15, 0.08);
  setTimeout(() => playTone(900, 0.15, 0.08), 80);
}

/** Call hangup sound (500Hz + 350Hz descending) */
export function notifCallHangup() {
  if (!getNotifSettings().callEvents) return;
  playTone(500, 0.15, 0.06);
  setTimeout(() => playTone(350, 0.2, 0.06), 100);
}

/** Broadcast alert sound */
export function notifBroadcast() {
  playTone(800, 0.1, 0.08);
  setTimeout(() => playTone(1000, 0.15, 0.08), 120);
}
