/**
 * New-notification detection for the in-session alert (chime + toast).
 *
 * Pure: the previously-seen id set is passed in, so the logic is
 * deterministic and unit-testable. The FIRST observation (prev = null)
 * returns nothing — reminders present at login are not "new".
 */

export interface WatchedNotification {
  id: string;
  message: string;
}

/**
 * Notifications whose id was not present in `prevIds`. When `prevIds` is
 * null (first observation) nothing is returned, so the initial batch never
 * triggers an alert.
 */
export function findNewNotifications(
  prevIds: ReadonlySet<string> | null,
  notifications: readonly WatchedNotification[],
): WatchedNotification[] {
  if (!prevIds) return [];
  return notifications.filter(n => !prevIds.has(n.id));
}