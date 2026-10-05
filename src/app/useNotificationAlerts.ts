/**
 * In-session notification alerts — chime + toast when NEW reminders appear.
 *
 * Extracted from src/App.tsx (split campaign, no behaviour change): the effect
 * compared the previous notification-id set with the current one, and only
 * alerted on reminders that arrived DURING the session. The first observation
 * (session start) never alerts — otherwise every login would chime for reminders
 * that were already on screen.
 *
 * The previous set lives in a ref, so a re-render that leaves the list unchanged
 * does not re-alert; only a genuinely new id does.
 */
import { useEffect, useRef } from 'react';
import type { DashboardNotification } from './useDashboard';
import type { TranslationDict } from '../i18n/translations';
import type { useToast } from '../lib/useToast';
import { playNotificationChime } from '../lib/notificationSound';
import { findNewNotifications } from '../lib/notificationWatch';

/** Only the surface this hook needs from the toast controller. */
type ToastApi = Pick<ReturnType<typeof useToast>, 'warning'>;

export function useNotificationAlerts(
  notifications: DashboardNotification[],
  t: TranslationDict,
  toast: ToastApi,
): void {
  const prevIdsRef = useRef<ReadonlySet<string> | null>(null);

  useEffect(() => {
    const prev = prevIdsRef.current;
    const fresh = findNewNotifications(prev, notifications);
    prevIdsRef.current = new Set(notifications.map((n) => n.id));
    // First observation (session start) never alerts.
    if (!prev || fresh.length === 0) return;
    playNotificationChime();
    if (fresh.length === 1) {
      toast.warning(fresh[0].message);
    } else {
      toast.warning(t.newNotifications.replace('{n}', String(fresh.length)));
    }
  }, [notifications, t, toast]);
}
