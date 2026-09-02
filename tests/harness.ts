/**
 * Shared happy-dom test harness — the pieces every hook/view suite used to
 * copy verbatim:
 *
 *   • installDomGlobals()  — happy-dom window/document/… on globalThis
 *     (plus optional extra globals and an alert forwarder);
 *   • stubAlert(target)    — globalThis.alert spy (node has no alert),
 *     returns a restore function;
 *   • renderHook(hook, args) — mounts the REAL hook through a host
 *     component, keeps a live ref to its API (a snapshot taken before an
 *     `act` would see stale state — always read through the ref), supports
 *     re-rendering with fresh args and unmounting.
 *
 * Module-mock caveat: suites that mock a module (node:test
 * --experimental-test-module-mocks) must keep registering their mock BEFORE
 * importing the hook — this module imports neither hooks nor mocked modules,
 * so importing it first is always safe.
 */
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';

export interface DomGlobalsOptions {
  /** Extra globals to define alongside the standard set. */
  extra?: Record<string, unknown>;
  /** Forward globalThis.alert to the happy-dom window's alert. */
  forwardAlert?: boolean;
}

/** Install happy-dom's window/document (and friends) on globalThis. */
export function installDomGlobals(options: DomGlobalsOptions = {}): Window {
  const win = new Window({ url: 'http://localhost/' });
  const define = (key: string, value: unknown): void => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  };
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('HTMLElement', win.HTMLElement);
  define('Element', win.Element);
  define('Node', win.Node);
  define('Event', win.Event);
  define('CustomEvent', win.CustomEvent);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('localStorage', win.localStorage);
  if (options.forwardAlert) {
    const forward = (msg: string) => {
      (win as unknown as { alert: (m: string) => void }).alert(msg);
    };
    define('alert', forward);
  }
  for (const [key, value] of Object.entries(options.extra ?? {})) {
    define(key, value);
  }
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
    writable: true,
  });
  return win;
}

/** Stub globalThis.alert (node has none) and restore after the test. */
export function stubAlert(target: string[]): () => void {
  const original = globalThis.alert as unknown;
  globalThis.alert = ((msg: string) => { target.push(msg); }) as typeof alert;
  return () => {
    globalThis.alert = original as typeof alert;
  };
}

export interface HookRender<TArgs, TApi> {
  /** Live ref — always read the hook API through it after an `act`. */
  api: { current: TApi | null };
  /** Re-render the host with new hook args (fresh closures for stateful hooks). */
  rerender: (nextArgs: TArgs) => void;
  /** Unmount the host and remove its container. */
  unmount: () => void;
}

/**
 * Host component: renders the hook for real, storing its API in the shared
 * ref. The generic hook is widened to `unknown` at the boundary — the
 * public renderHook signature keeps full type safety.
 */
function HookHost(props: {
  hook: (args: unknown) => unknown;
  args: unknown;
  api: { current: unknown };
}): null {
  props.api.current = props.hook(props.args);
  return null;
}

/**
 * Mounts the real hook, keeps a live API ref, supports re-render/unmount.
 *
 * `externalRef` lets suites keep their own long-lived ref object: the host
 * writes the CURRENT render's API into it on every render, so reading it
 * after an `act` always sees fresh state (the same contract the old local
 * Harness components provided).
 */
export function renderHook<TArgs, TApi>(
  hook: (args: TArgs) => TApi,
  args: TArgs,
  externalRef?: { current: TApi | null }
): HookRender<TArgs, TApi> {
  const api = externalRef ?? { current: null as TApi | null };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  let currentArgs = args;

  const render = (): void => {
    act(() => {
      root.render(createElement(HookHost, {
        hook: hook as (args: unknown) => unknown,
        args: currentArgs as unknown,
        api: api as { current: unknown },
      }));
    });
  };
  render();

  return {
    api,
    rerender: (nextArgs: TArgs) => {
      currentArgs = nextArgs;
      render();
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}