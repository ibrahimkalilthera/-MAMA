/**
 * Notification chime — a short two-note "ding" played through a lazily
 * created Web Audio context.
 *
 * Safe everywhere: without a window or an AudioContext (SSR, happy-dom,
 * blocked autoplay, no audio device) it silently does nothing. The context
 * is created on first use and reused; if the browser suspended it
 * (autoplay policy), it is resumed on the next chime.
 */

type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

// One context per AudioContext constructor (a WeakMap keeps multiple fake
// constructors in tests naturally isolated — and the real browser's single
// constructor gets exactly one context).
const contexts = new WeakMap<object, AudioContext>();

export function playNotificationChime(): void {
  try {
    const audioWin = typeof window !== 'undefined' ? (window as AudioWindow) : null;
    const Ctor = audioWin?.AudioContext ?? audioWin?.webkitAudioContext;
    if (!Ctor) return;

    if (!contexts.has(Ctor)) contexts.set(Ctor, new Ctor());
    const ctx = contexts.get(Ctor) as AudioContext;
    if (ctx.state === 'suspended') void ctx.resume();

    const now = ctx.currentTime;
    // Two gentle ascending notes (E5 → A5).
    [659.25, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.13;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  } catch {
    // No audio device or blocked autoplay — stay silent.
  }
}