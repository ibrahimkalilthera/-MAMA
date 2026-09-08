/**
 * happy-dom render tests for the ErrorBoundary filet de sécurité.
 *
 * The boundary guards the lazily-loaded zones of the app (MainViews,
 * AppModals, ArchivesView, the Excel/Bordereau modal hosts) — without it, a
 * crash while rendering a lazy chunk unmounts the WHOLE React tree (blank
 * page). These tests prove the boundary:
 *
 *   • renders its children untouched while there is no error;
 *   • catches a render-time throw and shows the themed error card (message,
 *     « Réessayer » / « Recharger » buttons) instead of a blank page;
 *   • always logs the error to the console (the fallback never hides it);
 *   • "Réessayer" resets the boundary so a fixed subtree can remount.
 *
 * Pure suite: happy-dom (installDomGlobals), react-dom/client, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement, Component } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { installDomGlobals } from './harness';

const win = installDomGlobals();

// A child that throws when mounted with a flag, or renders plain text.
const Bomb = ({ armed }: { armed: boolean }) => {
  if (armed) throw new Error('boom du sous-arbre');
  return createElement('div', null, 'contenu sain');
};

// A child that can be toggled between throwing and healthy to prove « Réessayer ».
// The `armed` flag lives in a mutable ref so the test can disarm the subtree
// BEFORE clicking Réessayer — exactly like a parent fixing its state after a
// transient failure.
const armedRef: { current: boolean } = { current: true };
class ToggleBomb extends Component<Record<string, never>, never> {
  render() {
    if (armedRef.current) throw new Error('erreur transitoire');
    return createElement('div', null, 'remonté après réessai');
  }
}

const theme = {
  card: 'bg-white',
  border: 'border-slate-200',
  muted: 'text-slate-500',
  isDark: false,
};

function mount(node: React.ReactNode): { root: Root; container: HTMLElement } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(node);
  });
  return { root, container };
}

function textOf(el: HTMLElement): string {
  return el.textContent ?? '';
}

describe('ErrorBoundary — filet de sécurité des zones lazy', () => {
  it('renders its children untouched while nothing throws', () => {
    const { root, container } = mount(
      createElement(ErrorBoundary, {
        currentTheme: theme,
        label: 'la vue',
        children: createElement(Bomb, { armed: false }),
      }),
    );
    assert.match(textOf(container), /contenu sain/, 'healthy children render normally');
    assert.ok(!container.querySelector('[role="alert"]'), 'no error card while healthy');
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it('catches a render-time throw and shows the error card instead of a blank page', () => {
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => { logged.push(args); };

    const { root, container } = mount(
      createElement(ErrorBoundary, {
        currentTheme: theme,
        label: 'la vue',
        children: createElement(Bomb, { armed: true }),
      }),
    );

    const alert = container.querySelector('[role="alert"]');
    assert.ok(alert, 'error card rendered (not a blank page)');
    assert.match(textOf(alert as HTMLElement), /Une erreur est survenue/, 'title mentions the error');
    assert.match(textOf(alert as HTMLElement), /boom du sous-arbre/, 'the thrown message is shown');
    assert.ok(
      [...(alert?.querySelectorAll('button') ?? [])].some((b) => /Recharger/.test(textOf(b as HTMLElement))),
      'a Recharger button is available',
    );
    assert.ok(
      [...(alert?.querySelectorAll('button') ?? [])].some((b) => /Réessayer/.test(textOf(b as HTMLElement))),
      'a Réessayer button is available',
    );

    // The error is ALWAYS logged — the fallback never hides the console.
    assert.ok(logged.length > 0, 'componentDidCatch logged the error to the console');
    assert.ok(
      logged.some((l) => Array.isArray(l) && l.some((p) => String(p).includes('boom du sous-arbre'))),
      'the logged entry carries the error message',
    );

    console.error = originalError;
    act(() => root.unmount());
    document.body.removeChild(container);
  });

  it('« Réessayer » resets the boundary so a fixed subtree can remount', () => {
    const { root, container } = mount(
      createElement(ErrorBoundary, {
        currentTheme: theme,
        label: 'le bordereau',
        children: createElement(ToggleBomb),
      }),
    );
    assert.ok(container.querySelector('[role="alert"]'), 'boundary caught the first throw');

    // The parent fixes the transient failure, then the user retries.
    armedRef.current = false;
    const retry = [...(container.querySelectorAll('button') ?? [])].find((b) => /Réessayer/.test(textOf(b as HTMLElement)));
    assert.ok(retry, 'Réessayer button present');
    act(() => {
      (retry as HTMLButtonElement).click();
    });
    // The same subtree now renders healthy content.
    assert.match(textOf(container), /remonté après réessai/, 'subtree remounts after retry');
    assert.ok(!container.querySelector('[role="alert"]'), 'error card cleared after retry');
    armedRef.current = true;

    act(() => root.unmount());
    document.body.removeChild(container);
  });
});