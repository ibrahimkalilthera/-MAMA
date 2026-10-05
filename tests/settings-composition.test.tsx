// ─────────────────────────────────────────────────────────────────────────────
// SettingsView est une COQUILLE : cinq sections, dans cet ordre — préférences,
// sauvegarde, classes, comptes, puis la modale « Définir mot de passe ».
//
// La découpe de l'écran (700 → 39 lignes) a déplacé chaque section dans son
// propre composant. C'est exactement le genre de refactor qui peut en perdre une
// EN SILENCE : l'écran reste plausible, une commande disparaît, et aucun cas ne
// le dit. Ce fichier est la preuve que non.
//
// ── L'ordre est garanti par un MARQUEUR STABLE, pas par un libellé ───────────
//
// Chaque section expose un `data-slot` (voir les composants Settings*) — un nom
// technique, non traduit, qui ne bouge pas quand la copie change. Le test lit
// donc CES marqueurs et leur ordre : une section retirée, réordonnée ou absorbée
// fait tomber un cas NOMMÉ, et un simple changement de libellé (ou de langue) ne
// casse plus le test ni, pire, ne le laisse passer vert en masquant l'inversion.
// Repérer les sections par leur TEXTE traduit rendait la garantie dépendante de
// la copie : le jour où la copie changeait, le test jugeait autre chose.
//
// Ce qui est verrouillé, MESURÉ SUR LA VUE MONTÉE (jamais sur le source, qui
// resterait vert même si le composant ne rendait plus rien) :
//
//   • le panneau `data-slot="settings-panel"` contient la pile
//     `data-slot="settings-sections"`, qui porte HUIT enfants marqués, CHACUN
//     avec son `data-slot`, DANS L'ORDRE. La première section (préférences) en
//     occupe cinq (langue, devise, densité des tableaux, thème, logo) : 5 +
//     sauvegarde + classes + comptes ;
//   • la cinquième section (la modale de mot de passe,
//     `data-slot="settings-password-modal"`) est rendue APRÈS la pile et HORS
//     d'elle : c'est une section, pas un bloc de plus.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type { MainViewsProps } from '../src/app/mainViewsProps';
import { SettingsView } from '../src/components/SettingsView';
import {
  SETTINGS_PANEL_SLOT,
  SETTINGS_STACK_SLOT,
  SETTINGS_PASSWORD_MODAL_SLOT,
  SETTINGS_STACK_SLOTS,
} from '../scripts/lib/settings-composition.mjs';
import { slotSelector } from '../scripts/lib/slot-selector.mjs';
import { translations } from '../src/i18n/translations';
import type { UserProfile } from '../src/lib/useAuth';
import { installDomGlobals } from './harness';
import { makeProps } from './views-harness';

const t = translations.en;

const win = installDomGlobals();
// AnimatePresence anime la modale ; le talon WAAPI de happy-dom n'« achève »
// jamais, donc les animations se résolvent instantanément (même talon que
// settings-filter-honesty.test).
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

/**
 * Monte la VRAIE SettingsView sous le vrai contrat de props. `passwordTarget`
 * laissé à sa valeur dérivée (null) : la modale reste fermée, donc la pile est
 * la seule racine rendue.
 */
function mount(overrides: Partial<MainViewsProps> = {}): {
  container: HTMLElement;
  root: ReturnType<typeof createRoot>;
} {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(
        MainViewsContext.Provider,
        { value: makeProps({ t, ...overrides }) },
        createElement(SettingsView),
      ),
    );
  });
  return { container, root };
}

function unmount(container: HTMLElement, root: ReturnType<typeof createRoot>): void {
  act(() => {
    root.unmount();
  });
  document.body.removeChild(container);
}

/** La pile de composition (`SETTINGS_STACK_SLOT`), sous le panneau. */
function compositionRoot(container: HTMLElement): HTMLElement {
  const panel = container.querySelector(slotSelector(SETTINGS_PANEL_SLOT));
  assert.ok(panel, `le panneau de réglages (${SETTINGS_PANEL_SLOT}) est rendu`);
  const stack = panel.querySelector(slotSelector(SETTINGS_STACK_SLOT));
  assert.ok(stack, `la pile de sections (${SETTINGS_STACK_SLOT}) est rendue`);
  return stack as HTMLElement;
}

const TARGET: UserProfile = {
  id: 'p-settings-target',
  email: 'cible@mamathera.org',
  fullName: 'Cible Réglages',
  role: 'admin',
};

describe('SettingsView — la composition est verrouillée', () => {
  it('la pile porte huit enfants, marqués du data-slot de leur section, dans l’ordre', () => {
    const { container, root } = mount();
    try {
      const kids = Array.from(compositionRoot(container).children);

      // Le NOMBRE d'enfants fait foi : c'est la LONGUEUR de la table partagée
      // (`scripts/lib/settings-composition.mjs`), la même que lit le contrôle de
      // source. Ajouter ou retirer un bloc sans mettre la table à jour échoue
      // ici ET là-bas : la mise à jour est obligatoire, jamais optionnelle.
      assert.equal(
        kids.length,
        SETTINGS_STACK_SLOTS.length,
        `la pile doit porter ${SETTINGS_STACK_SLOTS.length} enfants : les cinq blocs de préférences, puis sauvegarde, classes et comptes`,
      );

      const slots = kids.map((kid) => kid.getAttribute('data-slot'));
      assert.deepEqual(
        slots,
        SETTINGS_STACK_SLOTS,
        'l’ordre des enfants est celui de la table — un retrait, un ajout ou une inversion tombe ici',
      );
      assert.equal(
        new Set(slots).size,
        SETTINGS_STACK_SLOTS.length,
        'chaque section porte un marqueur UNIQUE (deux sections ne peuvent pas se confondre)',
      );
    } finally {
      unmount(container, root);
    }
  });

  it('la cinquième section — la modale de mot de passe — est rendue APRÈS la pile, hors d’elle', () => {
    const { container, root } = mount({ passwordTarget: TARGET });
    try {
      const roots = Array.from(container.children);
      assert.equal(roots.length, 2, 'deux racines rendues : le panneau, puis la modale');

      const [panel, modal] = roots;
      assert.equal(panel!.getAttribute('data-slot'), SETTINGS_PANEL_SLOT);
      assert.equal(
        modal!.getAttribute('data-slot'),
        SETTINGS_PASSWORD_MODAL_SLOT,
        'la seconde racine, APRÈS la pile, est la modale « Définir mot de passe »',
      );

      assert.ok(
        !panel!.querySelector(slotSelector(SETTINGS_PASSWORD_MODAL_SLOT)),
        'la modale n’est pas un bloc de la pile : elle est une section à part',
      );
      assert.ok(
        modal!.querySelector('input[name="new-password"]'),
        'la modale porte bien son champ de mot de passe',
      );
    } finally {
      unmount(container, root);
    }
  });

  it('sans cible de mot de passe, la modale ne pèse rien — le panneau est la seule racine', () => {
    // Contre-épreuve : le cas précédent attribue la seconde racine à la modale ;
    // ici, la cible retirée, elle disparaît. Sans cela, une racine surnuméraire
    // (portail, wrapper) pourrait passer pour la modale.
    const { container, root } = mount();
    try {
      assert.equal(
        Array.from(container.children).length,
        1,
        'panneau seul : la modale ne rend rien tant qu’aucune cible n’est choisie',
      );
      assert.equal(
        container.querySelector(slotSelector(SETTINGS_PASSWORD_MODAL_SLOT)),
        null,
        'aucune modale dans le DOM sans cible',
      );
    } finally {
      unmount(container, root);
    }
  });
});
