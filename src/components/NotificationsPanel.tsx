/**
 * Notifications bell — a bell button next to the header date opening a
 * dropdown of due/note reminders.
 *
 * A11y: the bell carries an aria-label with the UNREAD count, the dropdown
 * is role="dialog" with a label, Escape closes it (useEscapeToClose, same
 * stack as every other overlay), clicking outside closes it, and focus
 * moves to the panel's close button when it opens.
 *
 * Read-state: the parent owns the dismissed-id list (`readIds`). Opening
 * the dropdown marks every current reminder as read, so the bell badge
 * disappears right away; reminders that arrive while the panel is open can
 * still be dismissed with the "mark all as read" button. The list shows
 * ALL reminders (read ones dimmed) so they stay reviewable, and clicking
 * one opens the student's profile.
 */
import { useEffect, useRef, useState } from 'react';
import { Bell, CheckCircle2, CheckCheck, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { DashboardNotification } from '../app/useDashboard';
import type { TranslationDict } from '../i18n/translations';
import { useEscapeToClose } from '../lib/useEscapeToClose';
import { relativeDateLabel } from '../lib/relativeDate';

export interface NotificationsPanelProps {
  notifications: DashboardNotification[];
  onOpenStudent: (studentId: string) => void;
  t: TranslationDict;
  lang: 'en' | 'fr';
  readIds: string[];
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}

export function NotificationsPanel({ notifications, onOpenStudent, t, lang, readIds, onMarkRead, onMarkAllRead }: NotificationsPanelProps) {
  const now = new Date();

  const relativeLabel = (date: string): string => {
    const label = relativeDateLabel(date, now);
    if (label.kind === 'today') return t.today;
    if (label.kind === 'yesterday') return t.yesterday;
    if (label.kind === 'daysAgo') return t.daysAgo.replace('{n}', String(label.days));
    return new Date(label.date).toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  useEscapeToClose(open, () => setOpen(false));

  // Opening the dropdown dismisses every current reminder (badge disappears).
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      onMarkAllRead();
    }
    wasOpenRef.current = open;
  }, [open, onMarkAllRead]);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  const read = new Set(readIds);
  const unread = notifications.filter(n => !read.has(n.id));
  const unreadCount = unread.length;

  return (
    <div className="relative">
      {/* Transparent viewport backdrop — click outside closes the dropdown. */}
      {open && <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />}

      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`${t.notifications}${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
        aria-expanded={open}
        className={`relative z-50 p-2.5 rounded-xl border transition-all ${
          open
            ? 'bg-emerald-600 text-white border-emerald-600 shadow-lg shadow-emerald-600/20'
            : 'text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 hover:text-emerald-600 dark:hover:text-emerald-400'
        }`}
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-black flex items-center justify-center shadow">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={t.notifications}
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full mt-3 w-[min(92vw,380px)] z-50 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 dark:border-slate-800">
              <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                {t.notifications}
              </span>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-all"
                  >
                    <CheckCheck size={13} />
                    <span className="hidden sm:inline">{t.markAllRead}</span>
                  </button>
                )}
                <button
                  ref={closeRef}
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t.close}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
              {notifications.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <CheckCircle2 size={24} className="mx-auto mb-2 text-emerald-500" />
                  <p className="text-xs font-bold text-slate-400 dark:text-slate-500">{t.noNotifications}</p>
                </div>
              ) : (
                notifications.map(n => {
                  const isRead = read.has(n.id);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => {
                        onOpenStudent(n.studentId);
                        onMarkRead(n.id);
                        setOpen(false);
                      }}
                      className={`w-full text-left px-5 py-3.5 flex items-start gap-3 border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors last:border-b-0 ${
                        isRead ? 'opacity-50' : ''
                      } ${
                        n.type === 'due' ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      <Bell size={16} className={`mt-0.5 flex-shrink-0 ${n.type === 'due' ? 'text-amber-500' : 'text-rose-500'}`} />
                      <span className="min-w-0">
                        <span className="block text-xs font-bold leading-relaxed">{n.message}</span>
                        <span className="block text-[10px] font-semibold opacity-60 mt-0.5">{relativeLabel(n.date)}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}