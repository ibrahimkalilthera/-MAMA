/**
 * Root mount guard test — proves the ErrorBoundary wraps the very FIRST
 * render of the app, i.e. a crash inside App itself (not a lazy chunk).
 *
 * The guard lives in src/app/rootBoundary.tsx, extracted from main.tsx
 * exactly so it can be tested: the entry point pulls `import './index.css'`
 * (which the node test runner cannot parse) and executes its module-level
 * code on import. main.tsx renders exactly `<RootBoundary App={App} />`
 * inside StrictMode, so testing this component tests the root mount guard.
 *
 * Before this guard, a render-time throw in App unmounted the whole React
 * tree → silent blank page. The async-import catch in main.tsx only covers a
 * MODULE-load failure (missing Supabase config, « Configuration manquante »);
 * a render-time crash must land on the boundary card « Une erreur est
 * survenue dans l'application ».
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { RootBoundary } from '../src/app/rootBoundary';
import { useYear } from '../src/app/yearContext';
import { installDomGlobals } from './harness';

installDomGlobals();

// A healthy App stand-in that also proves YearProvider wraps it: it reads the
// real year context through the public useYear() hook, so a missing provider
// would throw and the test would catch the wrong failure.
function HealthyApp(): React.ReactElement {
  const { selectedYear } = useYear();
  return createElement('div', null, `app saine — ${selectedYear}`);
}

// An App stand-in that always crashes on first render — the exact failure the
// root boundary must contain.
function BombApp(): never {
  throw new Error('crash au premier rendu');
}

function textOf(el: HTMLElement): string {
  return el.textContent ?? '';
}

function mount(node: React.ReactNode): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { root, container };
}

describe('RootBoundary — filet de sécurité au tout premier rendu (main.tsx)', () => {
  it('rend l’app saine sans carte d’erreur, sous le YearProvider', () => {
    const { root, container } = mount(createElement(RootBoundary, { App: HealthyApp }));
    assert.match(textOf(container), /app saine/, 'healthy App renders untouched');
    assert.ok(!container.querySelector('[role="alert"]'), 'no error card while healthy');
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it('un crash d’App au premier rendu affiche la carte d’erreur, pas une page blanche', () => {
    // Silence React's expected error logs for this deliberately crashing tree.
    const originalError = console.error;
    console.error = () => {};

    const { root, container } = mount(createElement(RootBoundary, { App: BombApp }));

    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert, 'error card rendered at the root (not a blank page)');
    const text = textOf(alert as HTMLElement);
    assert.match(text, /Une erreur est survenue dans l'application/, 'the root boundary card mentions the app');
    assert.match(text, /crash au premier rendu/, 'the thrown message is surfaced');
    assert.ok(!/Configuration manquante/.test(text), 'not the config-error screen (module-load path untouched)');
    const buttons = [...(alert?.querySelectorAll('button') ?? [])].map((b) => textOf(b as HTMLElement));
    assert.ok(buttons.some((b) => /Réessayer/.test(b)), 'Réessayer button available');
    assert.ok(buttons.some((b) => /Recharger/.test(b)), 'Recharger button available');

    console.error = originalError;
    act(() => root.unmount());
    document.body.removeChild(container);
  });
});