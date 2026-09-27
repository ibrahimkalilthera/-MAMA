/**
 * happy-dom render tests for the NotificationsPanel bell + dropdown.
 *
 * Same environment as floating-chat.test.tsx: the WAAPI ticker of happy-dom
 * never advances, so Element.animate is stubbed with instantly-finished
 * animations (enter resolves immediately; exit-completion is not asserted).
 * The component is presentational: open/close, unread badge, per-item and
 * mark-all callbacks, and the all-clear state are verified with spies.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import type { DashboardNotification } from '../src/app/useDashboard';
import { NotificationsPanel } from '../src/components/NotificationsPanel';
import { isAuditArchiveAnchor } from '../src/lib/settingsAnchor';
import { installDomGlobals } from './harness';

const t = translations.fr as TranslationDict;

const win = installDomGlobals({
  extra: {
    requestAnimationFrame: (cb: FrameRequestCallback): number =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number,
    cancelAnimationFrame: (id: number): void => clearTimeout(id),
  },
});
Object.defineProperty(globalThis, 'MouseEvent', { value: win.MouseEvent, configurable: true, writable: true });
win.requestAnimationFrame = ((cb: FrameRequestCallback): number =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number) as unknown as typeof win.requestAnimationFrame;
win.cancelAnimationFrame = ((id: number): void => clearTimeout(id)) as unknown as typeof win.cancelAnimationFrame;
const finishedAnimation = {
  finished: Promise.resolve(),
  currentTime: 0,
  playState: 'finished',
  effect: null,
  onfinish: null,
  oncancel: null,
  play: () => {},
  pause: () => {},
  cancel: () => {},
  finish: () => {},
  reverse: () => {},
  commitStyles: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
};
win.Element.prototype.animate = (() => finishedAnimation) as unknown as typeof win.Element.prototype.animate;
win.Element.prototype.getAnimations = (() => []) as unknown as typeof win.Element.prototype.getAnimations;
(win.HTMLElement.prototype as { animate?: unknown }).animate = finishedAnimation;

/** Local calendar date `n` days before now (date-only — the panel parses
 *  date-only strings as local days, so the label is deterministic even near
 *  midnight in UTC+ timezones, where toISOString() would shift the day). */
const daysAgoISO = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// due → anchored today, note → anchored 3 days ago (stable labels).
const due: DashboardNotification = { id: 'due-s1', type: 'due', message: 'A: Paiement dû dans moins de 2 jours', studentId: 's1', date: daysAgoISO(0) };
const note: DashboardNotification = { id: 'note-s2', type: 'note', message: 'B: Pas de mise à jour depuis la note (3+ jours)', studentId: 's2', date: daysAgoISO(3) };

interface Fixture {
  notifications: DashboardNotification[];
  readIds: string[];
  /** Reminders the user deleted (hidden) — optional, defaults to none. */
  deletedIds?: string[];
}

const noop = (): void => {};

function Harness(props: Fixture & {
  onOpenStudent: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onMarkUnread: (id: string) => void;
  onOpenCalendarDate: (date: string) => void;
  onOpenPayroll?: () => void;
  onOpenSettings?: () => void;
  onDelete?: (id: string) => void;
  onClearAll?: () => void;
  onRestoreAll?: () => void;
}): React.ReactNode {
  return (
    <NotificationsPanel
      notifications={props.notifications}
      onOpenStudent={props.onOpenStudent}
      t={t}
      lang="fr"
      readIds={props.readIds}
      deletedIds={props.deletedIds ?? []}
      onMarkRead={props.onMarkRead}
      onMarkAllRead={props.onMarkAllRead}
      onMarkUnread={props.onMarkUnread}
      onDelete={props.onDelete ?? noop}
      onClearAll={props.onClearAll ?? noop}
      onRestoreAll={props.onRestoreAll ?? noop}
      onOpenCalendarDate={props.onOpenCalendarDate}
      onOpenPayroll={props.onOpenPayroll ?? noop}
      onOpenSettings={props.onOpenSettings ?? noop}
    />
  );
}

function mount(): { root: Root; container: Element } {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as Element);
  return { root, container: container as unknown as Element };
}

const q = (selector: string): Element | null =>
  win.document.querySelector(selector) as unknown as Element | null;

const qa = (selector: string): Element[] =>
  Array.from(win.document.querySelectorAll(selector)) as unknown as Element[];

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

const bell = (): Element | null => q('button[aria-expanded]');
const dialogButtons = (): Element[] => qa('[role="dialog"] button');
const buttonWithText = (text: string): Element | undefined =>
  dialogButtons().find(b => b.textContent?.includes(text));
const dialogRows = (): Element[] => qa('[role="dialog"] [role="button"]');
const rowWithText = (text: string): Element | undefined =>
  dialogRows().find(r => r.textContent?.includes(text));

describe('NotificationsPanel — happy-dom render', () => {
  it('badge and aria-label reflect only unread notifications', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (2)');

      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (1)');

      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications');
      assert.equal(q('[class*="bg-rose-500"]'), null, 'no badge when everything is read');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('opening the dropdown marks everything read and lists all reminders (read dimmed)', async () => {
    const markedAll: boolean[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true), onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });

      assert.deepEqual(markedAll, [true], 'opening fires onMarkAllRead once (badge disappears in the app)');
      const dialog = q('[role="dialog"]');
      assert.ok(dialog, 'dropdown opens as a dialog');
      assert.equal(dialog?.getAttribute('aria-label'), t.notifications);
      assert.ok(dialog?.textContent?.includes(note.message), 'unread reminder is listed');
      assert.ok(dialog?.textContent?.includes(due.message), 'read reminder is still listed (dimmed)');
      assert.ok(dialog?.textContent?.includes(t.daysAgo.replace('{n}', '3')), 'relative date "il y a 3 jours" is shown');

      // Read items render dimmed (opacity-50), unread ones do not.
      const dueRow = rowWithText(due.message);
      const noteRow = rowWithText(note.message);
      assert.ok(dueRow?.classList.contains('opacity-50'), 'read reminder is dimmed');
      assert.ok(!noteRow?.classList.contains('opacity-50'), 'unread reminder is not dimmed');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('clicking a reminder opens the student and marks it read', async () => {
    const opened: string[] = [];
    const marked: string[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: (id: string) => marked.push(id), onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });
      // The reminder click also closes the panel (exit animation never
      // completes under happy-dom — see floating-chat.test.tsx), so the
      // dispatch runs in a SYNC act: handlers fire synchronously and the
      // close/exit path is left to a real-browser e2e.
      act(() => { click(rowWithText(due.message) as Element); });

      assert.deepEqual(opened, ['s1']);
      assert.deepEqual(marked, ['due-s1']);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('mark-all button dismisses late-arriving unread items', async () => {
    const markedAll: boolean[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true), onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });
      assert.deepEqual(markedAll, [true], 'opening already fired onMarkAllRead');
      const btn = buttonWithText(t.markAllRead);
      assert.ok(btn, 'mark-all button rendered while props still report unread items');
      const dialog = q('[role="dialog"]');
      assert.ok(dialog?.textContent?.includes(t.today), 'relative date "Aujourd\'hui" is shown for the due reminder');
      await act(async () => { click(btn as Element); });
      assert.deepEqual(markedAll, [true, true], 'manual mark-all fires again');

      // Parent adopts all ids → button gone, reminders stay listed (dimmed).
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true), onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      assert.equal(buttonWithText(t.markAllRead), undefined, 'no mark-all button when everything is read');
      const d = q('[role="dialog"]');
      assert.ok(d?.textContent?.includes(due.message) && d?.textContent?.includes(note.message), 'read reminders remain listed (dimmed)');
      assert.ok(!d?.textContent?.includes(t.noNotifications), 'no all-clear state while reminders exist');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('a read reminder can be flagged back as unread with its button', async () => {
    const unmarked: string[] = [];
    const opened: string[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: (id: string) => opened.push(id), onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: (id: string) => unmarked.push(id), onOpenCalendarDate: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });

      // Only the read (due) row carries the unread button.
      const unreadButtons = dialogButtons().filter(b => b.getAttribute('aria-label') === t.markAsUnread);
      assert.equal(unreadButtons.length, 1, 'one unread button, on the read row');
      const noteRow = rowWithText(note.message);
      assert.ok(!noteRow?.querySelector(`[aria-label="${t.markAsUnread}"]`), 'unread rows have no unread button');

      act(() => { click(unreadButtons[0] as Element); });
      assert.deepEqual(unmarked, ['due-s1']);
      assert.deepEqual(opened, [], 'the unread button must not open the student (stopPropagation)');
      assert.ok(q('[role="dialog"]'), 'panel stays open after flagging unread');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('right-click flags a read reminder back as unread', async () => {
    const unmarked: string[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: (id: string) => unmarked.push(id), onOpenCalendarDate: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });

      const dueRow = rowWithText(due.message) as Element;
      const noteRow = rowWithText(note.message) as Element;
      act(() => {
        dueRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        noteRow.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      });
      assert.deepEqual(unmarked, ['due-s1'], 'right-click marks only the read row unread');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('a payroll alert (no student) opens the Payroll tab and marks it read', async () => {
    const opened: string[] = [];
    const marked: string[] = [];
    const payrollOpened: boolean[] = [];
    const payroll: DashboardNotification = {
      id: 'payroll-2026-5', type: 'payroll', message: 'Attention : Aucun paiement de salaire enregistré pour Juin', date: '2026-06-01',
    };
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [payroll], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: (id: string) => marked.push(id), onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {}, onOpenPayroll: () => payrollOpened.push(true),
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (1)');
      await act(async () => { click(bell() as Element); });
      assert.ok(q('[role="dialog"]')?.textContent?.includes(payroll.message), 'payroll alert is listed');

      act(() => { click(rowWithText(payroll.message) as Element); });
      assert.deepEqual(opened, [], 'no student profile for a payroll alert');
      assert.deepEqual(payrollOpened, [true], 'the payroll alert opens the Payroll tab');
      assert.deepEqual(marked, ['payroll-2026-5'], 'the payroll alert is marked read');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('an archive reminder (no student) opens Settings, never Payroll', async () => {
    const opened: string[] = [];
    const marked: string[] = [];
    const payrollOpened: boolean[] = [];
    const settingsOpened: boolean[] = [];
    const archive: DashboardNotification = {
      id: 'audit-archive-2026-S39', type: 'archive', message: 'Le journal de la semaine 2026-S39 n\'a pas encore été archivé en PDF (Réglages → Sauvegarde).', date: '2026-09-27',
    };
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [archive], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: (id: string) => marked.push(id), onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {}, onOpenPayroll: () => payrollOpened.push(true), onOpenSettings: () => settingsOpened.push(true),
        }));
      });
      await act(async () => { click(bell() as Element); });
      assert.ok(q('[role="dialog"]')?.textContent?.includes(archive.message), 'the archive reminder is listed');

      win.location.hash = '';
      act(() => { click(rowWithText(archive.message) as Element); });
      assert.deepEqual(opened, [], 'no student profile for an archive reminder');
      assert.deepEqual(settingsOpened, [true], 'the archive reminder opens Settings → Backup');
      assert.deepEqual(payrollOpened, [], 'and it must NOT open Payroll');
      assert.deepEqual(marked, ['audit-archive-2026-S39'], 'the archive reminder is marked read');
      assert.equal(
        isAuditArchiveAnchor(win.location.hash),
        true,
        'l’ancre profonde est posée AVANT d’ouvrir les Réglages — la carte s’y désigne elle-même',
      );
    } finally {
      act(() => root.unmount());
      container.remove();
      win.location.hash = '';
    }
  });

  it('clicking the relative date opens the calendar on that day', async () => {
    const opened: string[] = [];
    const calendarDates: string[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: (id: string) => opened.push(id), onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: (date: string) => calendarDates.push(date),
        }));
      });
      await act(async () => { click(bell() as Element); });

      const dateButton = rowWithText(note.message)?.querySelector(`[title="${t.openInCalendar}"]`);
      assert.ok(dateButton, 'the relative date renders as a calendar button');
      act(() => { click(dateButton as Element); });
      assert.deepEqual(calendarDates, [note.date], 'the calendar opens on the reminder\'s anchor date');
      assert.deepEqual(opened, [], 'the date button must not open the student profile');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('renders reminders most-recent-first (descending anchor date)', async () => {
    const { root, container } = mount();
    try {
      const old: DashboardNotification = { id: 'note-s9', type: 'note', message: 'Vieille note', studentId: 's9', date: daysAgoISO(10) };
      const mid: DashboardNotification = { id: 'note-s8', type: 'note', message: 'Note moyenne', studentId: 's8', date: daysAgoISO(5) };
      const payroll: DashboardNotification = { id: 'payroll-2026-3', type: 'payroll', message: 'Paie ancienne', date: '2026-04-01' };
      const recent: DashboardNotification = { id: 'due-s7', type: 'due', message: 'Due aujourd\'hui', studentId: 's7', date: daysAgoISO(0) };
      // Shuffled on purpose: the dropdown must reorder them.
      const shuffled = [old, recent, payroll, mid];
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: shuffled, readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });

      const order = dialogRows().map(r => r.textContent ?? '');
      const pos = (text: string): number => order.findIndex(o => o.includes(text));
      assert.ok(pos(recent.message) !== -1 && pos(mid.message) !== -1 && pos(old.message) !== -1 && pos(payroll.message) !== -1, 'all four reminders are listed');
      assert.ok(pos(recent.message) < pos(mid.message), 'today before 5 days ago');
      assert.ok(pos(mid.message) < pos(old.message), '5 days ago before 10 days ago');
      assert.ok(pos(old.message) < pos(payroll.message), '10 days ago before the fixed payroll date');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('each reminder carries a trash button that deletes it without opening the student', async () => {
    const deleted: string[] = [];
    const opened: string[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {}, onDelete: (id: string) => deleted.push(id),
        }));
      });
      await act(async () => { click(bell() as Element); });

      const dueRow = rowWithText(due.message) as Element;
      const trash = dueRow.querySelector(`[title="${t.deleteNotification}"]`);
      assert.ok(trash, 'the row renders a delete button');
      assert.ok(trash?.getAttribute('aria-label')?.includes(due.message), 'the delete button names the reminder it removes');

      act(() => { click(trash as Element); });
      assert.deepEqual(deleted, ['due-s1'], 'the delete button reports the deleted id');
      assert.deepEqual(opened, [], 'deleting must not open the student profile (stopPropagation)');
      assert.ok(q('[role="dialog"]'), 'panel stays open after deleting');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('a deleted reminder leaves the list and the unread badge', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], deletedIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (1)', 'the deleted reminder no longer counts as unread');
      await act(async () => { click(bell() as Element); });

      const dialog = q('[role="dialog"]');
      assert.ok(!dialog?.textContent?.includes(due.message), 'deleted reminder is gone from the list');
      assert.ok(dialog?.textContent?.includes(note.message), 'the other reminder stays listed');
      assert.equal(rowWithText(due.message), undefined, 'no ghost row for the deleted reminder');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('clear-all empties the whole dropdown in one click', async () => {
    const cleared: boolean[] = [];
    const deleted: string[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {}, onClearAll: () => cleared.push(true), onDelete: (id: string) => deleted.push(id),
        }));
      });
      await act(async () => { click(bell() as Element); });

      const btn = buttonWithText(t.clearNotifications);
      assert.ok(btn, 'clear-all button rendered while reminders are listed');
      await act(async () => { click(btn as Element); });
      assert.deepEqual(cleared, [true], 'clear-all cleans the whole list at once');
      assert.deepEqual(deleted, [], 'clear-all is not a per-row delete');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('an emptied-by-hand list shows the hidden state with restore, not the all-clear', async () => {
    const restored: boolean[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], deletedIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {}, onRestoreAll: () => restored.push(true),
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications', 'no badge once the list is cleaned');
      await act(async () => { click(bell() as Element); });

      const dialog = q('[role="dialog"]');
      assert.ok(dialog?.textContent?.includes(t.notificationsHidden), 'the hidden state says the reminders were hidden');
      assert.ok(!dialog?.textContent?.includes(t.noNotifications), 'never claim "all caught up" for reminders hidden by hand');
      assert.equal(buttonWithText(t.clearNotifications), undefined, 'nothing left to clear');

      const btn = buttonWithText(t.restoreNotifications);
      assert.ok(btn, 'restore button rendered');
      await act(async () => { click(btn as Element); });
      assert.deepEqual(restored, [true], 'restore brings the hidden reminders back');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('empty notifications show the all-clear state and no badge', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {}, onOpenCalendarDate: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications');
      await act(async () => { click(bell() as Element); });
      assert.ok(q('[role="dialog"]')?.textContent?.includes(t.noNotifications));
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
});