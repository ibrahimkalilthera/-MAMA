/**
 * Notification chime — a short two-note "ding" played through a lazily
 * created Web Audio context.
 *
 * Safe everywhere: without a window or an AudioContext (SSR, happy-dom,
 * blocked autoplay, no audio device) it silently does nothing. The context
 * is created on first use and reused; if the browser suspended it
 * (autoplay policy), it is resumed on the next chime.
 *
 * Autoplay policy: browsers refuse to start an AudioContext that is created
 * or resumed outside a user gesture and log
 *   "The AudioContext was not allowed to start. It must be resumed (or
 *    created) after a user gesture on the page."
 * Notifications can arrive mid-session before any interaction, so the
 * context is only created/resumed on the FIRST user gesture (pointer, key
 * or touch). A chime requested before that is held and played once the
 * gesture unlocks audio — no blocked-creation warning, no lost alert.
 */

type AudioWindow = Window & {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
};

// One context per AudioContext constructor (a WeakMap keeps multiple fake
// constructors in tests naturally isolated — and the real browser's single
// constructor gets exactly one context).
const contexts = new WeakMap<object, AudioContext>();

/** Whether a user gesture already unlocked audio for this page session. */
let unlocked = false;
/** A chime requested before the unlock gesture — played once at unlock. */
let pendingChime = false;

const GESTURE_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;

function acquireContext(): AudioContext | null {
  const audioWin = typeof window !== 'undefined' ? (window as AudioWindow) : null;
  const Ctor = audioWin?.AudioContext ?? audioWin?.webkitAudioContext;
  if (!Ctor) return null;
  if (!contexts.has(Ctor)) {
    try {
      contexts.set(Ctor, new Ctor());
    } catch {
      return null; // no audio device / blocked autoplay
    }
  }
  return contexts.get(Ctor) as AudioContext;
}

/**
 * Runs inside the first user gesture: creating (and, if suspended,
 * resuming) the context here is what lets the browser actually start it —
 * doing it later would log the autoplay warning. Detaches the gesture
 * listeners afterwards (the session is unlocked from then on).
 */
function unlockAudio(): void {
  if (unlocked) return;
  unlocked = true;
  const ctx = acquireContext();
  if (ctx?.state === 'suspended') void ctx.resume();
  if (pendingChime) {
    pendingChime = false;
    if (ctx?.state === 'running') playNotes(ctx);
  }
  for (const ev of GESTURE_EVENTS) {
    window.removeEventListener(ev, unlockAudio);
  }
}

/** Lazily listens for the first user gesture (once per page session). */
function ensureGestureListener(): void {
  if (unlocked || typeof window === 'undefined') return;
  for (const ev of GESTURE_EVENTS) {
    window.addEventListener(ev, unlockAudio, { passive: true, once: true });
  }
}

function playNotes(ctx: AudioContext): void {
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
}

export function playNotificationChime(): void {
  ensureGestureListener();
  try {
    // Before the first user gesture, creating an AudioContext would be
    // blocked and would log the browser's autoplay warning — hold the
    // chime until the gesture unlocks audio.
    if (!unlocked) {
      pendingChime = true;
      return;
    }
    const ctx = acquireContext();
    if (!ctx || ctx.state !== 'running') return; // blocked autoplay — silent
    playNotes(ctx);
  } catch {
    // No audio device or blocked autoplay — stay silent.
  }
}

/**
 * Test-only: reset the module's gesture-unlock state so each test starts
 * from a fresh "no gesture yet" session (notification-sound.test.ts).
 */
export function __resetNotificationSoundForTests(): void {
  if (typeof window !== 'undefined') {
    for (const ev of GESTURE_EVENTS) {
      window.removeEventListener(ev, unlockAudio);
    }
  }
  unlocked = false;
  pendingChime = false;
}