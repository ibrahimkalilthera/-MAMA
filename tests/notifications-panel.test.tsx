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

const due: DashboardNotification = { id: 'due-s1', type: 'due', message: 'A: Paiement dû dans moins de 2 jours', studentId: 's1' };
const note: DashboardNotification = { id: 'note-s2', type: 'note', message: 'B: Pas de mise à jour depuis la note (3+ jours)', studentId: 's2' };

interface Fixture {
  notifications: DashboardNotification[];
  readIds: string[];
}

function Harness(props: Fixture & {
  onOpenStudent: (id: string) => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
}): React.ReactNode {
  return (
    <NotificationsPanel
      notifications={props.notifications}
      onOpenStudent={props.onOpenStudent}
      t={t}
      readIds={props.readIds}
      onMarkRead={props.onMarkRead}
      onMarkAllRead={props.onMarkAllRead}
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

describe('NotificationsPanel — happy-dom render', () => {
  it('badge and aria-label reflect only unread notifications', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (2)');

      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications (1)');

      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {},
        }));
      });
      assert.equal(bell()?.getAttribute('aria-label'), 'Notifications');
      assert.equal(q('[class*="bg-rose-500"]'), null, 'no badge when everything is read');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('opens the dropdown listing only unread reminders', async () => {
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });

      const dialog = q('[role="dialog"]');
      assert.ok(dialog, 'dropdown opens as a dialog');
      assert.equal(dialog?.getAttribute('aria-label'), t.notifications);
      assert.ok(dialog?.textContent?.includes(note.message), 'unread reminder is listed');
      assert.ok(!dialog?.textContent?.includes(due.message), 'read reminder is not listed');
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
          notifications: [due, note], readIds: [], onOpenStudent: (id: string) => opened.push(id), onMarkRead: (id: string) => marked.push(id), onMarkAllRead: () => {},
        }));
      });
      await act(async () => { click(bell() as Element); });
      // The reminder click also closes the panel (exit animation never
      // completes under happy-dom — see floating-chat.test.tsx), so the
      // dispatch runs in a SYNC act: handlers fire synchronously and the
      // close/exit path is left to a real-browser e2e.
      act(() => { click(buttonWithText(due.message) as Element); });

      assert.deepEqual(opened, ['s1']);
      assert.deepEqual(marked, ['due-s1']);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('mark-all button appears only with unread items and fires onMarkAllRead', async () => {
    const markedAll: boolean[] = [];
    const { root, container } = mount();
    try {
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true),
        }));
      });
      await act(async () => { click(bell() as Element); });
      const btn = buttonWithText(t.markAllRead);
      assert.ok(btn, 'mark-all button rendered when unread > 0');
      await act(async () => { click(btn as Element); });
      assert.deepEqual(markedAll, [true]);

      // Everything read → button disappears and the all-clear state shows.
      await act(async () => {
        root.render(createElement(Harness, {
          notifications: [due, note], readIds: ['due-s1', 'note-s2'], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => markedAll.push(true),
        }));
      });
      assert.equal(buttonWithText(t.markAllRead), undefined, 'no mark-all button when nothing is unread');
      assert.ok(q('[role="dialog"]')?.textContent?.includes(t.noNotifications), 'all-clear state when everything is read');
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
          notifications: [], readIds: [], onOpenStudent: () => {}, onMarkRead: () => {}, onMarkAllRead: () => {},
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