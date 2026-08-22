/**
 * Toast Notification System for MAMA THERA Finance Suite
 * 
 * Lightweight, bilingual toast notifications that display
 * save success/failure feedback to staff in Bamako.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, X, WifiOff } from 'lucide-react';

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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      timerRefs.current.forEach(timer => clearTimeout(timer));
      timerRefs.current.clear();
    };
  }, []);

  return { toasts, addToast, removeToast, success, error, warning, retrying, offline };
}

// ─── Component: ToastContainer ───────────────────────────────────────────────

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; text: string; icon: typeof CheckCircle2 }> = {
  success: {
    bg: 'bg-emerald-900/90',
    border: 'border-emerald-500/30',
    text: 'text-emerald-100',
    icon: CheckCircle2,
  },
  error: {
    bg: 'bg-red-900/90',
    border: 'border-red-500/30',
    text: 'text-red-100',
    icon: AlertCircle,
  },
  warning: {
    bg: 'bg-amber-900/90',
    border: 'border-amber-500/30',
    text: 'text-amber-100',
    icon: AlertCircle,
  },
  retrying: {
    bg: 'bg-orange-900/90',
    border: 'border-orange-500/30',
    text: 'text-orange-100',
    icon: RefreshCw,
  },
  offline: {
    bg: 'bg-slate-800/95',
    border: 'border-slate-500/30',
    text: 'text-slate-200',
    icon: WifiOff,
  },
};

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none"
      style={{ maxWidth: '380px' }}
    >
      {toasts.map((toast) => {
        const style = TOAST_STYLES[toast.type];
        const Icon = style.icon;
        const isRetrying = toast.type === 'retrying';

        return (
          <div
            key={toast.id}
            className={`
              pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-2xl
              backdrop-blur-sm ${style.bg} ${style.border}
              animate-[slideInRight_0.3s_ease-out]
            `}
            style={{
              animation: 'slideInRight 0.3s ease-out',
            }}
          >
            <Icon
              size={18}
              className={`${style.text} flex-shrink-0 mt-0.5 ${isRetrying ? 'animate-spin' : ''}`}
            />
            <p className={`text-sm font-medium ${style.text} flex-1`}>
              {toast.message}
            </p>
            <button
              onClick={() => onDismiss(toast.id)}
              className={`${style.text} opacity-60 hover:opacity-100 transition-opacity flex-shrink-0`}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}

      {/* Inline keyframes for the slide-in animation */}
      <style>{`
        @keyframes slideInRight {
          from {
            opacity: 0;
            transform: translateX(100%);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </div>
  );
}

// ─── Component: OfflineBanner ────────────────────────────────────────────────

interface OfflineBannerProps {
  lang?: 'en' | 'fr';
  pendingCount?: number;
  isSyncing?: boolean;
  onSync?: () => void;
}

export function OfflineBanner({ lang = 'en', pendingCount = 0, isSyncing = false, onSync }: OfflineBannerProps) {
  const [isOffline, setIsOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline && pendingCount === 0) return null;

  const isFr = lang === 'fr';

  return (
    <div className={`fixed top-0 left-0 right-0 z-[9998] ${isOffline ? 'bg-amber-600' : 'bg-emerald-700'} text-white text-center py-2 px-4 flex items-center justify-center gap-3 shadow-lg transition-colors`}>
      {isOffline ? <WifiOff size={16} className="flex-shrink-0" /> : <RefreshCw size={16} className={`flex-shrink-0 ${isSyncing ? 'animate-spin' : ''}`} />}
      
      <span className="text-xs font-bold tracking-wide">
        {isOffline ? (
          pendingCount > 0
            ? (isFr ? `Hors ligne — ${pendingCount} modification(s) enregistrée(s) localement` : `Offline — ${pendingCount} transaction(s) saved locally`)
            : (isFr ? 'Hors ligne — Les modifications seront enregistrées localement' : 'Offline — Changes will be queued locally')
        ) : (
          isFr ? `${pendingCount} transaction(s) hors-ligne en attente de synchronisation` : `${pendingCount} offline transaction(s) pending sync`
        )}
      </span>

      {onSync && pendingCount > 0 && !isOffline && (
        <button
          onClick={onSync}
          disabled={isSyncing}
          className="ml-2 bg-white/20 hover:bg-white/30 text-white text-xs font-bold px-3 py-1 rounded-md transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
          {isSyncing 
            ? (isFr ? 'Synchronisation...' : 'Syncing...') 
            : (isFr ? 'Synchroniser maintenant' : 'Sync Now')}
        </button>
      )}
    </div>
  );
}

// ─── Component: EnvBadge ─────────────────────────────────────────────────────

interface EnvBadgeProps {
  env: string;
}

export function EnvBadge({ env }: EnvBadgeProps) {
  // Only show in non-production environments
  if (env === 'production') return null;

  const label = env === 'staging' ? 'STAGING' : 'DEV';
  const color = env === 'staging' ? 'bg-amber-500' : 'bg-blue-500';

  return (
    <div className={`fixed top-2 left-2 z-[9997] ${color} text-white text-[10px] font-black tracking-widest px-2.5 py-1 rounded-full shadow-lg uppercase pointer-events-none`}>
      {label}
    </div>
  );
}
