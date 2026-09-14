/**
 * happy-dom unit tests for the academic-year context.
 *
 * Locks the YearContext contract introduced by the domain-E refactor:
 *   1. `useYear` outside a `<YearProvider>` throws a clear error (same
 *      convention as useMainViews / the MainViewsContext guard);
 *   2. inside the provider it returns the year state — `selectedYear`, an
 *      initially EMPTY string, `lockedYears` empty — and the setters actually
 *      update the value observed by a re-render.
 *   3. le choix de l'utilisateur survit à un rechargement (le provider relit
 *      `mama_thera_selected_year`), et rien n'est inventé quand il n'y en a pas.
 *
 * Le point 2 était `'2026-2027'` : ce littéral est exactement ce qui a rendu un
 * élève invisible le 2026-09-13 (l'app filtrait sur 2026-2027 pendant que le
 * formulaire écrivait 2024-2025). L'assertion ci-dessous verrouille la règle qui
 * l'a remplacé — l'année vient de la BASE (`academic_years.is_current`), le
 * provider n'en fabrique aucune.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { YearProvider } from '../src/app/YearProvider';
import { useYear } from '../src/app/yearContext';
import { installDomGlobals } from './harness';

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

  it('provides the year state and working setters, sans inventer d’année', () => {
    localStorage.removeItem('mama_thera_selected_year');
    const h = mountProviderHarness();
    try {
      assert.equal(
        h.api.selectedYear,
        '',
        'aucune année par défaut : une année fabriquée ici est celle que le formulaire écrivait pendant que les listes en filtraient une autre',
      );
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

  it('reprend le choix stocké au rechargement', () => {
    localStorage.setItem('mama_thera_selected_year', '2026-2027');
    const h = mountProviderHarness();
    try {
      assert.equal(
        h.api.selectedYear,
        '2026-2027',
        'sans cette reprise, le premier F5 ramenait l’app sur une autre année et faisait disparaître ce qu’on venait d’enregistrer',
      );
    } finally {
      act(() => h.root.unmount());
      localStorage.removeItem('mama_thera_selected_year');
    }
  });
});
