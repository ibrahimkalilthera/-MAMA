/**
 * Notification read-state + in-session alert domain hook — extracted verbatim
 * from App.tsx.
 *
 * Owns the notification lifecycle the app shell used to wire inline:
 *   - the per-user read-state (which reminder ids the user dismissed),
 *     persisted in localStorage and pruned of ids whose reminder is gone
 *     (so a reminder that comes back in a new due period alerts again);
 *   - `openCalendarOnDate`, the notification → calendar-day jump;
 *   - the in-session alert (chime + toast) for reminders that appear after
 *     the session started (another staff member's changes);
 *   - the silent 60 s light-refresh poll that lets reminders actually
 *     appear mid-session (gated by the session being live, the tab being
 *     visible and the device being online).
 *
 * All deps are injected as arguments (the pattern of the other app/ hooks);
 * the persistence/chime/detection logic lives in the notification libs.
 *
 * Call-site note: App.tsx calls this hook after usePayroll, because the
 * calendar-day setters (setSelectedCalendarDay from usePayments) must exist
 * before the hook body runs.
 */
import { useEffect, useRef, useState } from 'react';
import type { TranslationDict } from '../i18n/translations';
import { getReadNotificationIds, saveReadNotificationIds } from '../lib/notificationReads';
import { findNewNotifications } from '../lib/notificationWatch';
import { playNotificationChime } from '../lib/notificationSound';

export interface UseNotificationWatchDeps {
  /** Live reminders (from useDashboard) — the watcher only reads id/message. */
  notifications: readonly { id: string; message: string }[];
  /** Stable per-user storage key (auth.profile?.id ?? 'guest'). */
  userId: string;
  /** True while a session is live — gates the light-refresh poll. */
  enabled: boolean;
  /** Silent data refresh for the background poll (useSupabaseData.fetchAll). */
  fetchAll: (opts?: { silent?: boolean }) => Promise<void>;
  toast: { warning: (message: string) => void };
  t: TranslationDict;
  /** Bundle: select the day in the calendar view and open the day modal. */
  openCalendarDay: (day: Date) => void;
}

export function useNotificationWatch(deps: UseNotificationWatchDeps) {
  const { notifications, userId, enabled, fetchAll, toast, t, openCalendarDay } = deps;
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);

  // Load the persisted read-state when the user changes.
  useEffect(() => {
    setReadNotificationIds(getReadNotificationIds(userId));
  }, [userId]);

  useEffect(() => {
    // Prune dismissed ids that no longer correspond to a live reminder, so a
    // reminder that comes back later (new due period) notifies again.
    const liveIds = new Set(notifications.map(n => n.id));
    saveReadNotificationIds(userId, readNotificationIds.filter(id => liveIds.has(id)));
  }, [readNotificationIds, userId, notifications]);

  const markNotificationRead = (id: string): void => {
    setReadNotificationIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  };

  const markNotificationUnread = (id: string): void => {
    setReadNotificationIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev));
  };

  const markAllNotificationsRead = (): void => {
    setReadNotificationIds(notifications.map(n => n.id));
  };

  const openCalendarOnDate = (date: string): void => {
    // Parse as a LOCAL calendar day (never UTC midnight — month display
    // must not shift in negative-UTC timezones).
    const [y, m, d] = date.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    openCalendarDay(day);
  };

  // --- In-session notification alerts (chime + toast) ---

  const prevNotifIdsRef = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    const prev = prevNotifIdsRef.current;
    const fresh = findNewNotifications(prev, notifications);
    prevNotifIdsRef.current = new Set(notifications.map(n => n.id));
    // First observation (session start) never alerts.
    if (!prev || fresh.length === 0) return;
    playNotificationChime();
    if (fresh.length === 1) {
      toast.warning(fresh[0].message);
    } else {
      toast.warning(t.newNotifications.replace('{n}', String(fresh.length)));
    }
  }, [notifications, t, toast]);

  // Light background refresh so reminders can actually appear mid-session
  // (another staff member's changes). Silent: no loading flash, no error
  // banner; skipped when the tab is hidden or the device is offline.
  useEffect(() => {
    if (!enabled) return;
    const poll = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void fetchAll({ silent: true });
      }
    }, 60000);
    return () => clearInterval(poll);
  }, [enabled, fetchAll]);

  return {
    readNotificationIds,
    markNotificationRead,
    markNotificationUnread,
    markAllNotificationsRead,
    openCalendarOnDate,
  };
}
