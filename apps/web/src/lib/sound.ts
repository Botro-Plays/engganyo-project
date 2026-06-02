/**
 * Play a short notification chime using the Web Audio API.
 * No external assets required. Respects browser autoplay policy.
 */

let audioCtx: AudioContext | null = null;
let hasUserInteracted = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => null);
  }
  return audioCtx;
}

function trackInteraction() {
  if (hasUserInteracted) return;
  hasUserInteracted = true;
  getAudioContext()?.resume().catch(() => null);
}

if (typeof window !== 'undefined') {
  window.addEventListener('click', trackInteraction, { once: true });
  window.addEventListener('keydown', trackInteraction, { once: true });
  window.addEventListener('touchstart', trackInteraction, { once: true });
}

export function playNotificationSound() {
  const ctx = getAudioContext();
  if (!ctx || !hasUserInteracted) return;
  if (typeof document !== 'undefined' && document.hidden) return;

  const now = ctx.currentTime;

  // Oscillator 1 — higher pitch (B5)
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(987.77, now);
  gain1.gain.setValueAtTime(0.08, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  osc1.connect(gain1).connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.25);

  // Oscillator 2 — harmony (E6)
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(1318.51, now + 0.05);
  gain2.gain.setValueAtTime(0.06, now + 0.05);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  osc2.connect(gain2).connect(ctx.destination);
  osc2.start(now + 0.05);
  osc2.stop(now + 0.3);
}
