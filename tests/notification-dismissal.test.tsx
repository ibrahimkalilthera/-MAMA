/**
 * happy-dom render test for src/app/useNotificationDismissal.ts — the hook
 * App.tsx hands the bell's read/deleted state.
 *
 * The panel test covers what the user sees; this covers what the panel cannot:
 * per-user persistence, the prune rule against LIVE reminders (a reminder that
 * disappears and comes back must notify again), and the fact that hiding a
 * reminder never marks it read (and vice versa).
 *
 * Same environment as notification-reads.test.tsx: the module persists through
 * localStorage, so it legitimately needs the happy-dom globals.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { installDomGlobals } from './harness';
import { useNotificationDismissal } from '../src/app/useNotificationDismissal';
import type { NotificationDismissal } from '../src/app/useNotificationDismissal';
import type { DashboardNotification } from '../src/app/useDashboard';
import {
  getDeletedNotificationIds,
  getReadNotificationIds,
  saveDeletedNotificationIds,
  saveReadNotificationIds,
} from '../src/lib/notificationReads';

const win = installDomGlobals();

const due: DashboardNotification = { id: 'due-a', type: 'due', message: 'A: paiement dû', studentId: 'a', date: '2026-09-01' };
const note: DashboardNotification = { id: 'note-b', type: 'note', message: 'B: pas de mise à jour', studentId: 'b', date: '2026-09-02' };

/** Latest hook result — a probe component is the smallest way to drive a hook. */
let api: NotificationDismissal | null = null;

function Probe({ userId, notifications }: { userId: string; notifications: DashboardNotification[] }) {
  api = useNotificationDismissal(userId, notifications);
  return null;
}

interface Mounted {
  root: Root;
  rerender: (userId: string, notifications: DashboardNotification[]) => Promise<void>;
}

async function mountProbe(userId: string, notifications: DashboardNotification[]): Promise<Mounted> {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  const rerender = async (nextUserId: string, nextNotifications: DashboardNotification[]): Promise<void> => {
    await act(async () => {
      root.render(createElement(Probe, { userId: nextUserId, notifications: nextNotifications }));
    });
  };
  await rerender(userId, notifications);
  return { root, rerender };
}

/** Unmount + drop the container (each test mounts its own). */
async function unmount(mounted: Mounted): Promise<void> {
  await act(async () => mounted.root.unmount());
}

describe('useNotificationDismissal', () => {
  beforeEach(() => {
    localStorage.clear();
    api = null;
  });

  it('deleting hides the reminder for this user without marking it read', async () => {
    const mounted = await mountProbe('u1', [due, note]);
    try {
      act(() => { api?.deleteNotification('due-a'); });
      assert.deepEqual(api?.deletedIds, ['due-a'], 'the hook reports the hidden id');
      assert.deepEqual(getDeletedNotificationIds('u1'), ['due-a'], 'and persists it');
      assert.deepEqual(getReadNotificationIds('u1'), [], 'hiding is not reading');
      assert.deepEqual(getDeletedNotificationIds('u2'), [], 'another user is untouched');
    } finally {
      await unmount(mounted);
    }
  });

  it('restore brings everything back and leaves the read state alone', async () => {
    const mounted = await mountProbe('u1', [due, note]);
    try {
      act(() => {
        api?.deleteNotification('due-a');
        api?.markRead('note-b');
      });
      act(() => { api?.restoreDeletedNotifications(); });
      assert.deepEqual(api?.deletedIds, []);
      assert.deepEqual(getDeletedNotificationIds('u1'), []);
      assert.deepEqual(getReadNotificationIds('u1'), ['note-b'], 'restoring does not forget what was read');
    } finally {
      await unmount(mounted);
    }
  });

  it('clear-all hides every live reminder at once (and is idempotent)', async () => {
    const mounted = await mountProbe('u1', [due, note]);
    try {
      act(() => { api?.clearAllNotifications(); });
      assert.deepEqual([...(api?.deletedIds ?? [])].sort(), ['due-a', 'note-b']);
      act(() => { api?.clearAllNotifications(); });
      assert.deepEqual(getDeletedNotificationIds('u1').sort(), ['due-a', 'note-b'], 'no duplicates on a second clean');
    } finally {
      await unmount(mounted);
    }
  });

  it('loads the stored lists of the signed-in user', async () => {
    saveReadNotificationIds('u1', ['due-a']);
    saveDeletedNotificationIds('u1', ['note-b']);
    const mounted = await mountProbe('u1', [due, note]);
    try {
      assert.deepEqual(api?.readIds, ['due-a']);
      assert.deepEqual(api?.deletedIds, ['note-b']);
      // Switching user swaps both lists.
      await mounted.rerender('u2', [due, note]);
      assert.deepEqual(api?.readIds, []);
      assert.deepEqual(api?.deletedIds, []);
    } finally {
      await unmount(mounted);
    }
  });

  it('prunes ids that no longer match a live reminder (so they notify again)', async () => {
    saveReadNotificationIds('u1', ['due-a', 'gone-x']);
    saveDeletedNotificationIds('u1', ['due-a', 'gone-x']);
    const mounted = await mountProbe('u1', [due]);
    try {
      assert.deepEqual(getReadNotificationIds('u1'), ['due-a'], 'the id with no live reminder is dropped');
      assert.deepEqual(getDeletedNotificationIds('u1'), ['due-a']);
      assert.deepEqual(api?.deletedIds, ['due-a'], 'the in-memory list is pruned too, not just the storage');
      assert.deepEqual(api?.readIds, ['due-a']);
      // The reminder that had vanished comes back: it is NOT still hidden.
      await mounted.rerender('u1', [due, { ...due, id: 'gone-x' }]);
      assert.ok(!(api?.deletedIds ?? []).includes('gone-x'), 'a reminder that comes back must show again');
    } finally {
      await unmount(mounted);
    }
  });

  it('never prunes on an empty reminder list (first render before the data loads)', async () => {
    saveDeletedNotificationIds('u1', ['due-a']);
    const mounted = await mountProbe('u1', []);
    try {
      assert.deepEqual(api?.deletedIds, ['due-a'], 'an empty list right after login must not erase the stored ids');
      assert.deepEqual(getDeletedNotificationIds('u1'), ['due-a']);
    } finally {
      await unmount(mounted);
    }
  });

  it('marks read/unread without touching the hidden list', async () => {
    const mounted = await mountProbe('u1', [due, note]);
    try {
      act(() => { api?.markRead('due-a'); });
      act(() => { api?.markRead('due-a'); });
      assert.deepEqual(api?.readIds, ['due-a'], 'marking twice keeps a single id');
      act(() => { api?.markUnread('due-a'); });
      assert.deepEqual(api?.readIds, []);
      assert.deepEqual(getDeletedNotificationIds('u1'), [], 'reading never hides');
      act(() => { api?.deleteNotification('note-b'); });
      assert.deepEqual(getReadNotificationIds('u1'), [], 'hiding never reads');
    } finally {
      await unmount(mounted);
    }
  });
});
