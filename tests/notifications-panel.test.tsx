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
}

function Harness(props: Fixture & {
  onOpenStudent: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onMarkUnread: (id: string) => void;
}): React.ReactNode {
  return (
    <NotificationsPanel
      notifications={props.notifications}
      onOpenStudent={props.onOpenStudent}
      t={t}
      lang="fr"
      readIds={props.readIds}
      onMarkRead={props.onMarkRead}
      onMarkAllRead={props.onMarkAllRead}
      onMarkUnread={props.onMarkUnread}
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
          notifications: [due, note], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (2)');

      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (1)');

      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {},
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
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true), onMarkUnread: () => {},
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
          notifications: [due, note], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: (id: string) => marked.push(id), onMarkAllRead: () => {}, onMarkUnread: () => {},
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
          notifications: [due, note], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true), onMarkUnread: () => {},
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
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true), onMarkUnread: () => {},
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
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: (id: string) => opened.push(id), onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: (id: string) => unmarked.push(id),
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
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: (id: string) => unmarked.push(id),
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

  it('a payroll alert (no student) dismisses without opening a profile', async () => {
    const opened: string[] = [];
    const marked: string[] = [];
    const payroll: DashboardNotification = {
      id: 'payroll-2026-5', type: 'payroll', message: 'Attention : Aucun paiement de salaire enregistré pour Juin', date: '2026-06-01',
    };
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [payroll], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: (id: string) => marked.push(id), onMarkAllRead: () => {}, onMarkUnread: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (1)');
      await act(async () => { click(bell() as Element); });
      assert.ok(q('[role="dialog"]')?.textContent?.includes(payroll.message), 'payroll alert is listed');

      act(() => { click(rowWithText(payroll.message) as Element); });
      assert.deepEqual(opened, [], 'no student profile for a payroll alert');
      assert.deepEqual(marked, ['payroll-2026-5'], 'the payroll alert is marked read');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('empty notifications show the all-clear state and no badge', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {}, onMarkUnread: () => {},
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