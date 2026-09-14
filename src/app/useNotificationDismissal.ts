/**
 * Notification dismissal state (read + deleted) for the bell dropdown.
 *
 * The parent owns both id lists and persists them per user through
 * src/lib/notificationReads.ts. Extracted from App.tsx — the wiring there is
 * already at the line budget, and this keeps the two lists (and their pruning
 * rule) in one place.
 *
 * Pruning: an id that no longer matches a LIVE reminder is dropped from the
 * stored lists AND from the in-memory state, so a reminder that disappears and
 * comes back later (new due period, new note) notifies again instead of staying
 * hidden as read/deleted.
 *
 * Pruning never runs while the reminder list is empty — there is nothing to
 * compare against, and an empty list is also the shape of the very first render
 * (session restored, data not fetched yet). Without that guard, launching the
 * app would forget every stored id before the reminders even arrive.
 */
import { useCallback, useEffect, useState } from 'react';

import type { DashboardNotification } from './useDashboard';
import {
  getDeletedNotificationIds,
  getReadNotificationIds,
  saveDeletedNotificationIds,
  saveReadNotificationIds,
} from '../lib/notificationReads';

export interface NotificationDismissal {
  /** Ids the user has seen — the badge counts the rest. */
  readIds: string[];
  /** Ids the user deleted from the dropdown (hidden, not forgotten by the DB). */
  deletedIds: string[];
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  markAllRead: () => void;
  /** Hide one reminder from the dropdown (reversible via restoreAll). */
  deleteNotification: (id: string) => void;
  /** Hide every reminder currently in the dropdown. */
  clearAllNotifications: () => void;
  /** Bring back everything that was hidden. */
  restoreDeletedNotifications: () => void;
}

export function useNotificationDismissal(
  userId: string,
  notifications: readonly DashboardNotification[],
): NotificationDismissal {
  const [readIds, setReadIds] = useState<string[]>([]);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);

  // Load the stored state whenever the signed-in user changes.
  useEffect(() => {
    setReadIds(getReadNotificationIds(userId));
    setDeletedIds(getDeletedNotificationIds(userId));
  }, [userId]);

  // Persist both lists, pruned against the live reminders (same guard as the
  // state prune below — nothing is written while there is nothing to compare).
  useEffect(() => {
    if (notifications.length === 0) return;
    const live = new Set(notifications.map(n => n.id));
    saveReadNotificationIds(userId, readIds.filter(id => live.has(id)));
    saveDeletedNotificationIds(userId, deletedIds.filter(id => live.has(id)));
  }, [readIds, deletedIds, userId, notifications]);

  // Prune the STATE too, not just the storage: an id whose reminder no longer
  // exists must not stay read/hidden when that reminder comes back later (new
  // due period, new note).
  useEffect(() => {
    if (notifications.length === 0) return;
    const live = new Set(notifications.map(n => n.id));
    const keep = (prev: string[]): string[] => {
      const next = prev.filter(id => live.has(id));
      return next.length === prev.length ? prev : next;
    };
    setReadIds(keep);
    setDeletedIds(keep);
  }, [notifications]);

  const markRead = useCallback((id: string): void => {
    setReadIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const markUnread = useCallback((id: string): void => {
    setReadIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : prev));
  }, []);

  const markAllRead = useCallback((): void => {
    setReadIds(notifications.map(n => n.id));
  }, [notifications]);

  const deleteNotification = useCallback((id: string): void => {
    setDeletedIds(prev => (prev.includes(id) ? prev : [...prev, id]));
  }, []);

  const clearAllNotifications = useCallback((): void => {
    setDeletedIds(prev => Array.from(new Set([...prev, ...notifications.map(n => n.id)])));
  }, [notifications]);

  const restoreDeletedNotifications = useCallback((): void => {
    setDeletedIds([]);
  }, []);

  return {
    readIds,
    deletedIds,
    markRead,
    markUnread,
    markAllRead,
    deleteNotification,
    clearAllNotifications,
    restoreDeletedNotifications,
  };
}
