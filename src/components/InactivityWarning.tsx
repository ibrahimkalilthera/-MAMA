/**
 * Inactivity warning modal — shown by useInactivityLogout a minute before
 * the forced logout. Any user action (the stay button, Escape, or simply
 * clicking anywhere, which the activity listeners catch) restarts the timer.
 */
import { AnimatePresence, motion } from 'motion/react';
import { Clock } from 'lucide-react';
import type { TranslationDict } from '../i18n/translations';
import type { CurrentTheme } from '../app/mainViewsProps';

export interface InactivityWarningProps {
  open: boolean;
  remainingSeconds: number;
  t: TranslationDict;
  currentTheme: CurrentTheme;
  onStay: () => void;
}

export function InactivityWarning(props: InactivityWarningProps) {
  const { open, remainingSeconds, t, currentTheme, onStay } = props;

  return (
    <AnimatePresence>
      {open && (
        // Full-screen interruption surface — deliberate z-[80] (above app
        // chrome, below toasts), same dim as ModalShell's backdrop token so
        // every overlay reads identically.
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-slate-900/60 backdrop-blur-md flex items-center justify-center p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 40 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 40 }}
            role="dialog"
            aria-modal="true"
            aria-label={t.inactivityTitle}
            className={`relative ${currentTheme.card} w-full max-w-md rounded-[2rem] shadow-2xl border ${currentTheme.border} overflow-hidden p-8 text-center`}
          >
            <div className={`w-16 h-16 rounded-full ${currentTheme.isDark ? 'bg-amber-900/20 text-amber-500' : 'bg-amber-100 text-amber-800'} flex items-center justify-center mx-auto mb-4`}>
              <Clock size={24} />
            </div>
            <h2 className={`text-xl font-black mb-2 ${currentTheme.isDark ? 'text-emerald-400' : 'text-slate-800'}`}>
              {t.inactivityTitle}
            </h2>
            <p className={`text-sm mb-6 ${currentTheme.muted}`}>
              {t.inactivityMessage.replace('{seconds}', String(remainingSeconds))}
            </p>
            <button
              onClick={onStay}
              className="px-8 py-3 bg-amber-500 hover:bg-amber-600 text-amber-950 rounded-2xl font-black text-sm transition-all active:scale-95 shadow-lg shadow-amber-500/20"
            >
              {t.stayLoggedIn}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}