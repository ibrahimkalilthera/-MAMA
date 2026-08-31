/**
 * Toast Notification System for MAMA THERA Finance Suite
 * 
 * Lightweight, bilingual toast notifications that display
 * save success/failure feedback to staff in Bamako.
 */

import { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, RefreshCw, X, WifiOff } from 'lucide-react';
import type { Toast, ToastType } from '../lib/useToast';

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

  // Toasts anchor bottom-right with a 24px margin; the 380px design width
  // would overflow a 360px viewport, so clamp it to the viewport minus
  // symmetric margins (audit: this was the last overlay clipping on mobile).
  return (
    <div
      className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 pointer-events-none"
      style={{ maxWidth: 'min(380px, calc(100vw - 3rem))' }}
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
  t?: Record<string, string>;
}

export function OfflineBanner({ lang = 'en', pendingCount = 0, isSyncing = false, onSync, t = {} }: OfflineBannerProps) {
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
            ? (t.offlinePendingCount.replace('{count}', String(pendingCount)))
            : (t.offlineChangesWillBeQueuedLocally)
        ) : (
          t.offlinePendingSync.replace('{count}', String(pendingCount))
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
            ? (t.syncing) 
            : (t.syncNow)}
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
