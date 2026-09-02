/**
 * happy-dom unit tests for the useInactivityLogout domain hook.
 *
 * node:test mock timers replace setTimeout/setInterval, so the full
 * 30-minute window and the 60-second warning countdown run instantly.
 * Covered:
 *   1. after the window, the warning opens with the full countdown;
 *   2. the countdown reaches zero → signOut is called exactly once;
 *   3. any activity during the warning dismisses it and restarts the
 *      window (no logout);
 *   4. activity before the window ends also resets it;
 *   5. minutes are configurable (0 = disabled → no timers, no logout);
 *   6. setMinutes persists the choice and applies it immediately.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { act } from 'react';
import {
  useInactivityLogout,
  INACTIVITY_STORAGE_KEY,
  DEFAULT_INACTIVITY_MINUTES,
  INACTIVITY_WARN_SECONDS,
} from '../src/app/useInactivityLogout';
import { installDomGlobals, renderHook } from './harness';

const win = installDomGlobals();
// The hook listens on window keydown — happy-dom's KeyboardEvent must exist
// on globalThis for the tests to dispatch one.
Object.defineProperty(globalThis, 'KeyboardEvent', { value: win.KeyboardEvent, configurable: true, writable: true });

type Api = ReturnType<typeof useInactivityLogout>;

function makeDeps(signOut: () => Promise<void>): Parameters<typeof useInactivityLogout>[0] {
  return { enabled: true, signOut };
}

describe('useInactivityLogout', () => {
  it('opens the warning after the window and logs out when the countdown ends', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    win.localStorage.setItem(INACTIVITY_STORAGE_KEY, '30');
    let signOutCalls = 0;
    const ref: { current: Api | null } = { current: null };
    const { unmount } = renderHook(useInactivityLogout, makeDeps(async () => { signOutCalls++; }), ref);

    // before the window: nothing
    act(() => { ctx.mock.timers.tick(29 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, false);
    assert.equal(signOutCalls, 0);

    // window elapsed → warning with the full countdown
    act(() => { ctx.mock.timers.tick(60 * 1000); });
    assert.equal(ref.current!.warningOpen, true);
    assert.equal(ref.current!.remainingSeconds, INACTIVITY_WARN_SECONDS);

    // one second before zero: still no logout
    act(() => { ctx.mock.timers.tick((INACTIVITY_WARN_SECONDS - 1) * 1000); });
    assert.equal(signOutCalls, 0);

    // final second → forced logout, exactly once
    act(() => { ctx.mock.timers.tick(1000); });
    assert.equal(signOutCalls, 1);
    act(() => { ctx.mock.timers.tick(5000); });
    assert.equal(signOutCalls, 1, 'no repeated logout after the countdown');

    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('activity during the warning dismisses it and restarts the window', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    win.localStorage.setItem(INACTIVITY_STORAGE_KEY, '30');
    let signOutCalls = 0;
    const ref: { current: Api | null } = { current: null };
    const { unmount } = renderHook(useInactivityLogout, makeDeps(async () => { signOutCalls++; }), ref);

    // reach the warning
    act(() => { ctx.mock.timers.tick(30 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, true);
    assert.equal(ref.current!.remainingSeconds, INACTIVITY_WARN_SECONDS);

    // 10s into the countdown the user presses a key → warning gone, timer restarted
    act(() => { ctx.mock.timers.tick(10 * 1000); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown')); });
    assert.equal(ref.current!.warningOpen, false);
    assert.equal(signOutCalls, 0);

    // a full new window passes → warning again, still no logout until zero
    act(() => { ctx.mock.timers.tick(30 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, true);
    assert.equal(signOutCalls, 0);
    act(() => { ctx.mock.timers.tick(INACTIVITY_WARN_SECONDS * 1000); });
    assert.equal(signOutCalls, 1);

    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('activity before the window ends resets it', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    win.localStorage.setItem(INACTIVITY_STORAGE_KEY, '30');
    let signOutCalls = 0;
    const ref: { current: Api | null } = { current: null };
    const { unmount } = renderHook(useInactivityLogout, makeDeps(async () => { signOutCalls++; }), ref);

    act(() => { ctx.mock.timers.tick(20 * 60 * 1000); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown')); });

    // 20 more minutes (20 after the reset): still before the new 30-min window
    act(() => { ctx.mock.timers.tick(20 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, false);
    assert.equal(signOutCalls, 0);

    // 10 more minutes → window elapsed → warning
    act(() => { ctx.mock.timers.tick(10 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, true);

    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('minutes are configurable and 0 disables the timer', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    win.localStorage.setItem(INACTIVITY_STORAGE_KEY, '0');
    let signOutCalls = 0;
    const ref: { current: Api | null } = { current: null };
    const { unmount } = renderHook(useInactivityLogout, makeDeps(async () => { signOutCalls++; }), ref);

    act(() => { ctx.mock.timers.tick(10 * 60 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, false);
    assert.equal(signOutCalls, 0, '0 minutes = feature off');
    assert.equal(ref.current!.minutes, 0);

    // setMinutes(5) applies immediately
    act(() => { ref.current!.setMinutes(5); });
    assert.equal(ref.current!.minutes, 5);
    assert.equal(win.localStorage.getItem(INACTIVITY_STORAGE_KEY), '5');
    act(() => { ctx.mock.timers.tick(5 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, true);
    act(() => { ctx.mock.timers.tick(INACTIVITY_WARN_SECONDS * 1000); });
    assert.equal(signOutCalls, 1);

    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('does not run when disabled (logged out)', (ctx) => {
    ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
    win.localStorage.setItem(INACTIVITY_STORAGE_KEY, '30');
    let signOutCalls = 0;
    const ref: { current: Api | null } = { current: null };
    const { unmount } = renderHook(useInactivityLogout, { enabled: false, signOut: async () => { signOutCalls++; } }, ref);

    act(() => { ctx.mock.timers.tick(60 * 60 * 1000); });
    assert.equal(ref.current!.warningOpen, false);
    assert.equal(signOutCalls, 0);

    act(() => unmount());
    ctx.mock.timers.reset();
  });

  it('defaults to the documented window when nothing is stored', () => {
    win.localStorage.removeItem(INACTIVITY_STORAGE_KEY);
    const ref: { current: Api | null } = { current: null };
    const { unmount } = renderHook(useInactivityLogout, makeDeps(async () => {}), ref);
    assert.equal(ref.current!.minutes, DEFAULT_INACTIVITY_MINUTES);
    assert.equal(ref.current!.warningOpen, false);
    act(() => unmount());
  });
});