/**
 * Notification dismissal state persistence.
 *
 * Two per-user lists live in localStorage (ids are stable: `due-<studentId>` /
 * `note-<studentId>` / `payroll-…`):
 *   • read    — the ids the user has seen; the bell badge counts the rest;
 *   • deleted — the ids the user removed from the dropdown, so the list can be
 *               cleaned by hand without waiting for the reminder to expire.
 *
 * The two keys are independent: emptying the dropdown again never marks
 * anything as read, and vice versa. Corrupt or missing entries degrade to an
 * empty list; writes never throw.
 */

type DismissalKind = 'read' | 'deleted';

const keyFor = (kind: DismissalKind, userId: string): string => `mama-notifications-${kind}-v1:${userId}`;

/** Read one dismissal list for the user. Never throws. */
function getIds(kind: DismissalKind, userId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(kind, userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** Persist one dismissal list for the user. Never throws. */
function saveIds(kind: DismissalKind, userId: string, ids: string[]): void {
  try {
    localStorage.setItem(keyFor(kind, userId), JSON.stringify(ids));
  } catch {
    // Storage full / private mode — dismissal state simply won't persist.
  }
}

/** Read the ids the user has already dismissed. Never throws. */
export function getReadNotificationIds(userId: string): string[] {
  return getIds('read', userId);
}

/** Persist the dismissed ids for the user. Never throws. */
export function saveReadNotificationIds(userId: string, ids: string[]): void {
  saveIds('read', userId, ids);
}

/** Read the ids the user has deleted (hidden) from the dropdown. Never throws. */
export function getDeletedNotificationIds(userId: string): string[] {
  return getIds('deleted', userId);
}

/** Persist the deleted (hidden) ids for the user. Never throws. */
export function saveDeletedNotificationIds(userId: string, ids: string[]): void {
  saveIds('deleted', userId, ids);
}
