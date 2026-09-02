/**
 * Notification read-state persistence.
 *
 * The set of notification ids the current user has dismissed is stored per
 * user in localStorage (ids are stable: `due-<studentId>` / `note-<studentId>`).
 * Corrupt or missing entries degrade to an empty set; writes never throw.
 */

const keyFor = (userId: string): string => `mama-notifications-read-v1:${userId}`;

/** Read the ids the user has already dismissed. Never throws. */
export function getReadNotificationIds(userId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Persist the dismissed ids for the user. Never throws. */
export function saveReadNotificationIds(userId: string, ids: string[]): void {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(ids));
  } catch {
    // Storage full / private mode — read-state simply won't persist.
  }
}