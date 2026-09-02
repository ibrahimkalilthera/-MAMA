/**
 * Inactivity auto-logout — logs the user out after N minutes without any
 * user action, with a warning countdown before cutting the session.
 *
 * Behaviour:
 *   • Any real activity (pointer/key/scroll/touch/wheel; mousemove is
 *     throttled) restarts the full timer and dismisses the warning.
 *   • When the timer fires, a warning modal shows a 60-second countdown;
 *     the session is only ended when the countdown reaches zero.
 *   • The window is configurable (0 = disabled) and persisted in
 *     localStorage, so each browser keeps its own preference.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export const INACTIVITY_STORAGE_KEY = 'mama-thera:inactivity-minutes';
export const DEFAULT_INACTIVITY_MINUTES = 30;
export const INACTIVITY_WARN_SECONDS = 60;
const MAX_MINUTES = 480;

/** Events that count as immediate activity (mousemove handled separately). */
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;
/** mousemove only resets the timer at most once per window. */
const MOUSE_THROTTLE_MS = 30_000;

function loadMinutes(): number {
  try {
    const stored = localStorage.getItem(INACTIVITY_STORAGE_KEY);
    if (stored === null) return DEFAULT_INACTIVITY_MINUTES;
    const raw = Number(stored);
    if (Number.isFinite(raw) && raw >= 0 && raw <= MAX_MINUTES) return Math.floor(raw);
  } catch {
    /* storage unavailable — default */
  }
  return DEFAULT_INACTIVITY_MINUTES;
}

export interface InactivityLogoutApi {
  /** True while the pre-logout warning modal is visible. */
  warningOpen: boolean;
  /** Seconds left before the forced logout while the warning is shown. */
  remainingSeconds: number;
  /** Configured inactivity window in minutes (0 = disabled). */
  minutes: number;
  /** Change the window (persisted locally, 0 = disabled). */
  setMinutes: (minutes: number) => void;
  /** Dismiss the warning and restart the timer (any activity calls this). */
  reset: () => void;
}

export function useInactivityLogout(deps: {
  enabled: boolean;
  signOut: () => Promise<void>;
}): InactivityLogoutApi {
  const { enabled, signOut } = deps;
  const [minutes, setMinutesState] = useState<number>(loadMinutes);
  const [warningOpen, setWarningOpen] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(INACTIVITY_WARN_SECONDS);

  const minutesRef = useRef(minutes);
  minutesRef.current = minutes;
  const signOutRef = useRef(signOut);
  signOutRef.current = signOut;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const mainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const clearTimers = useCallback(() => {
    if (mainTimerRef.current !== null) {
      clearTimeout(mainTimerRef.current);
      mainTimerRef.current = null;
    }
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  /** Start (or restart) the full inactivity window; closes the warning. */
  const startMainTimer = useCallback(() => {
    clearTimers();
    setWarningOpen(false);
    if (!enabledRef.current || minutesRef.current <= 0) return;
    mainTimerRef.current = setTimeout(() => {
      // Warning phase: count down, then force the logout.
      setWarningOpen(true);
      setRemainingSeconds(INACTIVITY_WARN_SECONDS);
      countdownRef.current = setInterval(() => {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            if (countdownRef.current !== null) {
              clearInterval(countdownRef.current);
              countdownRef.current = null;
            }
            void signOutRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }, minutesRef.current * 60 * 1000);
  }, [clearTimers]);

  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();
    startMainTimer();
  }, [startMainTimer]);

  // Start/stop with the session and when the window changes.
  useEffect(() => {
    if (enabled) {
      startMainTimer();
    } else {
      clearTimers();
      setWarningOpen(false);
    }
    return clearTimers;
  }, [enabled, startMainTimer, clearTimers]);

  // Activity listeners — any action restarts the window.
  useEffect(() => {
    if (!enabled) return;
    const onActivity = (): void => reset();
    const onMouseMove = (): void => {
      const now = Date.now();
      if (now - lastActivityRef.current >= MOUSE_THROTTLE_MS) reset();
    };
    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, onActivity, { passive: true });
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true });
    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, onActivity);
      }
      window.removeEventListener('mousemove', onMouseMove);
    };
  }, [enabled, reset]);

  const setMinutes = useCallback((m: number) => {
    const clamped = Math.min(MAX_MINUTES, Math.max(0, Math.floor(m) || 0));
    minutesRef.current = clamped;
    setMinutesState(clamped);
    try {
      localStorage.setItem(INACTIVITY_STORAGE_KEY, String(clamped));
    } catch {
      /* storage unavailable — window stays for this session only */
    }
    reset();
  }, [reset]);

  return {
    warningOpen,
    remainingSeconds,
    minutes,
    setMinutes,
    reset,
  };
}