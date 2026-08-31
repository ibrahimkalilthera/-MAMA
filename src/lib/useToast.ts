/**
 * Toast hook — the data + auto-dismiss logic behind the toast system.
 *
 * Lives apart from the ToastNotification components so that component files
 * only export components (react-refresh/only-export-components). The types
 * belong to the hook's contract and are re-used by the toast UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'warning' | 'retrying' | 'offline';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, default 4000
}

// ─── Hook: useToast ──────────────────────────────────────────────────────────

export function useToast(maxToasts: number = 3) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timerRefs = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timerRefs.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timerRefs.current.delete(id);
    }
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const newToast: Toast = { ...toast, id };
    const duration = toast.duration ?? 4000;

    setToasts(prev => {
      const updated = [...prev, newToast];
      // Keep only the latest N toasts
      return updated.slice(-maxToasts);
    });

    // Auto-dismiss (except 'offline' which persists)
    if (toast.type !== 'offline') {
      const timer = setTimeout(() => removeToast(id), duration);
      timerRefs.current.set(id, timer);
    }

    return id;
  }, [maxToasts, removeToast]);

  // Convenience methods
  const success = useCallback((message: string) => addToast({ type: 'success', message }), [addToast]);
  const error = useCallback((message: string) => addToast({ type: 'error', message, duration: 6000 }), [addToast]);
  const warning = useCallback((message: string) => addToast({ type: 'warning', message }), [addToast]);
  const retrying = useCallback((message: string) => addToast({ type: 'retrying', message, duration: 3000 }), [addToast]);
  const offline = useCallback((message: string) => addToast({ type: 'offline', message }), [addToast]);

  // Cleanup on unmount — capture the map inside the effect: by the time the
  // cleanup runs, `timerRefs.current` may have been reassigned.
  useEffect(() => {
    const timers = timerRefs.current;
    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { toasts, addToast, removeToast, success, error, warning, retrying, offline };
}
