/**
 * happy-dom unit tests for the academic-year context.
 *
 * Locks the YearContext contract introduced by the domain-E refactor:
 *   1. `useYear` outside a `<YearProvider>` throws a clear error (same
 *      convention as useMainViews / the MainViewsContext guard);
 *   2. inside the provider it returns the year state — `selectedYear` with
 *      its default `2026-2027`, `lockedYears` empty — and the setters
 *      actually update the value observed by a re-render.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { YearProvider } from '../src/app/YearProvider';
import { useYear } from '../src/app/yearContext';

/** Install happy-dom's window/document (and friends) on globalThis. */
function installDomGlobals(): Window {
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
  define('IS_REACT_ACT_ENVIRONMENT', true);
  return win;
}

installDomGlobals();

/** Renders the real hook under the real provider and returns a live API ref. */
function mountProviderHarness(): { api: { selectedYear: string; lockedYears: string[]; setSelectedYear: (y: string) => void; setLockedYears: (y: string[]) => void }; root: Root } {
  let api!: ReturnType<typeof useYear>;
  const root = createRoot(document.createElement('div'));
  act(() => {
    root.render(
      createElement(
        YearProvider,
        null,
        createElement(function Probe() {
          api = useYear();
          return null;
        }),
      ),
    );
  });
  const read = () => api;
  return { api: read(), root };
}

describe('YearContext', () => {
  it('useYear throws a clear error outside a provider', () => {
    let err: unknown = null;
    const root = createRoot(document.createElement('div'));
    act(() => {
      root.render(
        createElement(function Probe() {
          try {
            useYear();
          } catch (e) {
            err = e;
          }
          return null;
        }),
      );
    });
    act(() => root.unmount());
    assert.ok(err instanceof Error, 'expected useYear to throw');
    assert.match(err.message, /YearProvider/);
  });

  it('provides the default year state and working setters', () => {
    const h = mountProviderHarness();
    try {
      assert.equal(h.api.selectedYear, '2026-2027');
      assert.deepEqual(h.api.lockedYears, []);

      act(() => {
        h.api.setSelectedYear('2027-2028');
        h.api.setLockedYears(['2026-2027']);
      });

      // Re-read through a fresh probe render (the first snapshot closes over
      // the initial render's state).
      let fresh!: ReturnType<typeof useYear>;
      act(() => {
        h.root.render(
          createElement(
            YearProvider,
            null,
            createElement(function Probe() {
              fresh = useYear();
              return null;
            }),
          ),
        );
      });
      assert.equal(fresh.selectedYear, '2027-2028');
      assert.deepEqual(fresh.lockedYears, ['2026-2027']);
    } finally {
      act(() => h.root.unmount());
    }
  });
});
