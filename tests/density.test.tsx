/**
 * Table density (R11) — comfort/compact, persisted.
 *
 * Three things are measured, none of them the source:
 *   • the storage contract (default, round-trip, corrupt value → default);
 *   • `useDensityState` loads the stored value and persists every change;
 *   • the Settings → Préférences toggle writes the choice through the context
 *     and re-reads it from storage (so a reload really keeps it).
 *
 * The app-shell class that the CSS keys on (`density-compact`) is asserted in
 * tests/appshell-overlays.test.tsx, next to the shell that carries it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_DENSITY, getStoredDensity, saveDensity } from '../src/lib/density';
import { DensityContext, useDensityState } from '../src/app/densityContext';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { SettingsPreferencesCard } from '../src/components/SettingsPreferencesCard';
import { translations } from '../src/i18n/translations';
import { installDomGlobals, renderHook } from './harness';
import { makeProps } from './views-harness';

// `makeProps` fournit le dictionnaire EN (declaredDefaults), donc les libellés
// de la carte sont en anglais — le cas lit les mêmes clés que le composant.
const t = translations.en;

describe('densité des tableaux', () => {
  it('persiste le choix et retombe sur « confort » sur une valeur corrompue', () => {
    installDomGlobals();
    saveDensity('comfort');
    assert.equal(getStoredDensity(), 'comfort', 'le défaut est confort');
    saveDensity('compact');
    assert.equal(getStoredDensity(), 'compact', 'le choix fait est relu');
    localStorage.setItem('school-finance-density-v1', 'wat');
    assert.equal(getStoredDensity(), 'comfort', 'une valeur inconnue dégrade vers le défaut');
    assert.equal(DEFAULT_DENSITY, 'comfort');
  });

  it('useDensityState charge la valeur stockée puis la persiste à chaque changement', () => {
    installDomGlobals();
    saveDensity('compact');
    const { api, unmount } = renderHook(useDensityState, undefined);
    assert.equal(api.current?.density, 'compact', 'l’état part de la valeur stockée');
    act(() => api.current?.setDensity('comfort'));
    assert.equal(api.current?.density, 'comfort', 'le changement est appliqué');
    assert.equal(getStoredDensity(), 'comfort', 'et écrit — donc un rechargement le garde');
    unmount();
  });

  it('la bascule des Réglages met à jour le contexte et la persistance', () => {
    installDomGlobals();
    saveDensity('comfort');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function Host() {
      const density = useDensityState();
      return (          <MainViewsContext.Provider value={makeProps()}>

          <DensityContext.Provider value={density}>
            <SettingsPreferencesCard />
          </DensityContext.Provider>
        </MainViewsContext.Provider>
      );
    }

    try {
      act(() => { root.render(createElement(Host)); });
      const group = container.querySelector(`[role="group"][aria-label="${t.densityMode}"]`);
      assert.ok(group, 'la bascule de densité est rendue');
      const [comfort, compact] = [...group.querySelectorAll('button')];
      assert.ok(compact, 'les deux modes sont proposés');
      assert.equal(comfort.textContent, t.densityComfort);
      assert.equal(compact.textContent, t.densityCompact);
      assert.equal(comfort.getAttribute('aria-pressed'), 'true', 'confort est actif au départ');

      act(() => compact.click());
      assert.equal(compact.getAttribute('aria-pressed'), 'true', 'compact devient actif');
      assert.equal(comfort.getAttribute('aria-pressed'), 'false');
      assert.equal(getStoredDensity(), 'compact', 'le clic a été persisté');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
