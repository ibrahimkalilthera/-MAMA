/**
 * Verre des icônes (discret / net / animé) — la dose, persistée et choisie.
 *
 * Ce qui est mesuré, et pourquoi ces trois choses :
 *   • le contrat de STOCKAGE (défaut, aller-retour, valeur inconnue → défaut) : un
 *     réglage d'affichage qu'on perd au rechargement est un réglage qui n'existe
 *     pas, et une valeur corrompue ne doit pas laisser la couche sans dose ;
 *   • `useIconGlassState` CHARGE la valeur stockée puis PERSISTE chaque
 *     changement — c'est la même brique que la densité des tableaux, et c'est
 *     elle que la couche respecte ;
 *   • la bascule des Réglages écrit par le contexte ET en storage (donc un
 *     rechargement la garde), avec les trois doses proposées.
 *
 * La classe que la couche cible (`icon-glass-*`) est assertée dans
 * tests/appshell-overlays.test.tsx, à côté du shell qui la porte.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_ICON_GLASS, ICON_GLASS_LEVELS, getStoredIconGlass, saveIconGlass } from '../src/lib/iconGlass';
import { IconGlassContext, useIconGlass, useIconGlassState } from '../src/app/iconGlassContext';
import { MainViewsContext } from '../src/app/mainViewsContext';
import { SettingsPreferencesCard } from '../src/components/SettingsPreferencesCard';
import { translations } from '../src/i18n/translations';
import { installDomGlobals, renderHook } from './harness';
import { makeProps } from './views-harness';

// `makeProps` fournit le dictionnaire EN (declaredDefaults), donc les libellés
// de la carte sont en anglais — le cas lit les mêmes clés que le composant.
const t = translations.en;

describe('verre des icônes', () => {
  it('persiste le choix et retombe sur « animé » sur une valeur corrompue', () => {
    installDomGlobals();
    // Le défaut est la dose DÉJÀ livrée : personne ne doit voir son écran
    // changer sans l'avoir demandé.
    assert.equal(DEFAULT_ICON_GLASS, 'animated');
    localStorage.removeItem('school-finance-icon-glass-v1');
    assert.equal(getStoredIconGlass(), 'animated', 'sans choix enregistré, la dose livrée reste');

    saveIconGlass('discreet');
    assert.equal(getStoredIconGlass(), 'discreet', 'le choix fait est relu');
    saveIconGlass('crisp');
    assert.equal(getStoredIconGlass(), 'crisp', 'et un autre choix remplace le premier');

    localStorage.setItem('school-finance-icon-glass-v1', 'très-flou');
    assert.equal(getStoredIconGlass(), 'animated', 'une valeur inconnue dégrade vers la dose livrée');
  });

  it('les trois doses sont nommées, et ce sont exactement celles de la couche', () => {
    // La couche écrit `.icon-glass-discreet`, `.icon-glass-crisp` et
    // `.icon-glass-animated` : si cette liste et la feuille divergeaient, une dose
    // existerait dans le menu sans qu'aucune règle ne la respecte.
    assert.deepEqual(ICON_GLASS_LEVELS, ['discreet', 'crisp', 'animated']);
    assert.ok(ICON_GLASS_LEVELS.includes(DEFAULT_ICON_GLASS));
  });

  it('useIconGlassState charge la valeur stockée puis la persiste à chaque changement', () => {
    installDomGlobals();
    saveIconGlass('crisp');
    const { api, unmount } = renderHook(useIconGlassState, undefined);
    assert.equal(api.current?.iconGlass, 'crisp', 'l’état part de la valeur stockée');
    act(() => api.current?.setIconGlass('discreet'));
    assert.equal(api.current?.iconGlass, 'discreet', 'le changement est appliqué');
    assert.equal(getStoredIconGlass(), 'discreet', 'et écrit — donc un rechargement le garde');
    unmount();
  });

  it('sans provider, la lecture rend la dose livrée et la bascule est sans effet', () => {
    // Les tests de coquille montent <AppShell> seul : le repli doit être la dose
    // livrée, jamais une valeur qui ferait bouger la couche.
    const { api } = renderHook(useIconGlass, undefined);
    assert.equal(api.current?.iconGlass, DEFAULT_ICON_GLASS);
    assert.doesNotThrow(() => api.current?.setIconGlass('discreet'));
  });

  it('la bascule des Réglages met à jour le contexte et la persistance', () => {
    installDomGlobals();
    saveIconGlass('animated');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    function Host() {
      const iconGlass = useIconGlassState();
      return (
        <MainViewsContext.Provider value={makeProps()}>
          <IconGlassContext.Provider value={iconGlass}>
            <SettingsPreferencesCard />
          </IconGlassContext.Provider>
        </MainViewsContext.Provider>
      );
    }

    try {
      act(() => {
        root.render(createElement(Host));
      });
      const group = container.querySelector(`[role="group"][aria-label="${t.iconGlassMode}"]`);
      assert.ok(group, 'la bascule du verre des icônes est rendue');
      const [discreet, crisp, animated] = [...group.querySelectorAll('button')];
      assert.ok(discreet && crisp && animated, 'les trois doses sont proposées');
      assert.equal(discreet.textContent, t.iconGlassDiscreet);
      assert.equal(crisp.textContent, t.iconGlassCrisp);
      assert.equal(animated.textContent, t.iconGlassAnimated);
      assert.equal(animated.getAttribute('aria-pressed'), 'true', 'la dose livrée est active au départ');

      act(() => discreet.click());
      assert.equal(getStoredIconGlass(), 'discreet', 'choisir une dose l’écrit en storage');
      assert.equal(discreet.getAttribute('aria-pressed'), 'true', 'et la bascule suit');
      assert.equal(animated.getAttribute('aria-pressed'), 'false', 'une seule dose active à la fois');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('la préférence survit à un remontage — elle est relue du storage, pas d’un état de session', () => {
    installDomGlobals();
    saveIconGlass('crisp');
    const first = renderHook(useIconGlassState, undefined);
    act(() => first.api.current?.setIconGlass('discreet'));
    first.unmount();

    const second = renderHook(useIconGlassState, undefined);
    assert.equal(second.api.current?.iconGlass, 'discreet', 'le remontage relit le choix enregistré');
    second.unmount();
  });
});
