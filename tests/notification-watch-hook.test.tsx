/**
 * happy-dom unit tests for the useNotificationWatch domain hook (read-state
 * persistence + in-session alerts), extracted verbatim from App.tsx. The
 * notification libs (localStorage persistence, new-id detection, chime) are
 * real — happy-dom provides localStorage and the chime is a silent no-op
 * without an AudioContext, so no module mocks are needed:
 *   1. the persisted read-state is loaded per user on mount — the in-memory
 *      set is the raw stored list; only the copy that gets SAVED is pruned
 *      to live reminder ids (the mechanism that lets a re-due reminder with
 *      a stable id alert again after a reload);
 *   2. the mark* handlers update the id set and storage converges to the
 *      pruned (live-only) subset;
 *   3. openCalendarOnDate parses the date as a LOCAL day (never UTC midnight);
 *   4. the first observation never alerts; a fresh reminder toasts exactly once.
 *
 * enabled:false in the harness — none of these cases exercise the light-
 * refresh poll, so no 60 s interval is ever scheduled (a leaked interval
 * would keep the test runner alive).
 */
import { act } from 'react';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import type { TranslationDict } from '../src/i18n/translations';
import { installDomGlobals, renderHook } from './harness';
import type { UseNotificationWatchDeps } from '../src/app/useNotificationWatch';

const t = translations.fr as TranslationDict;
installDomGlobals();

const { useNotificationWatch } = await import('../src/app/useNotificationWatch');

const KEY = (userId: string) => `mama-notifications-read-v1:${userId}`;

const notif = (id: string) => ({ id, type: 'due' as const, message: `Relance ${id}`, studentId: id, date: '2026-09-05' });

type Api = ReturnType<typeof useNotificationWatch>;

function render(userId = 'u1', notifications: ReturnType<typeof notif>[] = []) {
  const warnings: string[] = [];
  const openedDays: Date[] = [];
  const toast = { warning: (m: string) => { warnings.push(m); } };
  const fetchAll = async () => {};
  const deps = (n: ReturnType<typeof notif>[]): UseNotificationWatchDeps => ({
    notifications: n,
    userId,
    enabled: false,
    fetchAll,
    toast,
    t,
    openCalendarDay: (day: Date) => { openedDays.push(day); },
  });
  const { api, unmount, rerender } = renderHook(useNotificationWatch, deps(notifications));
  return {
    api,
    unmount,
    rerender: (n: ReturnType<typeof notif>[]) => rerender(deps(n)),
    warnings,
    openedDays,
  };
}

describe('useNotificationWatch', () => {
  it('loads the persisted read-state per user; only live ids are saved back', () => {
    localStorage.clear();
    localStorage.setItem(KEY('u1'), JSON.stringify(['n1', 'n2']));
    const { api, unmount } = render('u1', [notif('n1')]);
    // Verbatim load: the in-memory set is the full stored list. Stale ids
    // are dropped only from what gets SAVED (see below), so a reminder that
    // comes back in a new due period alerts again after a reload.
    assert.deepEqual(api.current!.readNotificationIds, ['n1', 'n2']);
    // …but storage converges to the live subset ('n2' no longer exists).
    const persisted = JSON.parse(localStorage.getItem(KEY('u1')) ?? '[]');
    assert.deepEqual(persisted, ['n1'], 'storage pruned to live ids');
    act(() => unmount());
  });

  it('mark handlers update the id set; storage converges to the live subset', () => {
    localStorage.clear();
    localStorage.setItem(KEY('u1'), JSON.stringify(['n1', 'n2']));
    const { api, unmount } = render('u1', [notif('n1'), notif('n3')]);

    // The in-memory set starts as the raw stored list (n2 is stale).
    assert.deepEqual(api.current!.readNotificationIds, ['n1', 'n2']);

    act(() => { api.current!.markNotificationRead('n3'); });
    assert.deepEqual(api.current!.readNotificationIds, ['n1', 'n2', 'n3']);

    act(() => { api.current!.markNotificationUnread('n1'); });
    assert.deepEqual(api.current!.readNotificationIds, ['n2', 'n3']);

    // Storage only ever keeps ids of reminders that are still live.
    const persisted = JSON.parse(localStorage.getItem(KEY('u1')) ?? '[]');
    assert.deepEqual(persisted, ['n3'], 'storage tracks the pruned read ids');
    act(() => unmount());
  });

  it('markAllNotificationsRead marks every live reminder', () => {
    localStorage.clear();
    const { api, unmount } = render('u1', [notif('n1'), notif('n2')]);
    act(() => { api.current!.markAllNotificationsRead(); });
    assert.deepEqual(api.current!.readNotificationIds, ['n1', 'n2']);
    act(() => unmount());
  });

  it('openCalendarOnDate builds a LOCAL calendar day (no UTC shift)', () => {
    localStorage.clear();
    const { api, unmount, openedDays } = render();
    act(() => { api.current!.openCalendarOnDate('2026-09-05'); });
    assert.equal(openedDays.length, 1);
    const day = openedDays[0];
    assert.equal(day.getFullYear(), 2026);
    assert.equal(day.getMonth(), 8, 'September is month 8');
    assert.equal(day.getDate(), 5);
    assert.equal(day.getHours(), 0, 'local midnight — never UTC-shifted');
    act(() => unmount());
  });

  it('first observation never alerts; a fresh reminder toasts exactly once', () => {
    localStorage.clear();
    const { api, unmount, rerender, warnings } = render('u1', []);
    assert.equal(warnings.length, 0, 'no alert for the initial batch');

    // A new reminder arrives mid-session → one toast with its message.
    rerender([notif('n1')]);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0], 'Relance n1');

    // Same ids (new array instance) → no additional alert.
    rerender([notif('n1')]);
    assert.equal(warnings.length, 1, 'no re-alert for an already-seen reminder');

    // A second fresh reminder → one alert.
    rerender([notif('n1'), notif('n2')]);
    assert.equal(warnings.length, 2);
    assert.equal(warnings[1], 'Relance n2');
    act(() => unmount());
  });
});
