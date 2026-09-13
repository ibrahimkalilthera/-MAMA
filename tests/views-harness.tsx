// ─────────────────────────────────────────────────────────────────────────────
// tests/views-harness.tsx — le contexte dont une vue a besoin pour être rendue.
//
// Ce fichier ne RECOPIE plus les props une par une. Il portait ~200 lignes de
// `noop` (une par prop, plus une soixantaine d'icônes) : chaque prop nouvelle
// exigeait donc d'éditer ce fichier, et l'oubli se lisait mal — la prop valait
// `undefined`, la vue rendait autre chose, et le cas passait.
//
// Les valeurs viennent maintenant du CONTRAT (`tests/views-contract.ts` lit
// `src/app/mainViewsProps.ts` avec l'API du compilateur et dérive une valeur par
// type). Ce qui reste ici est ce que la dérivation ne peut PAS deviner — le
// CONTENU de six props, chacune avec sa raison — plus ce qui n'est pas un type du
// module (`auth`, `t`), qui est NOMMÉ au lieu d'être deviné.
//
// Trois propriétés qui comptent, et qui ne se voient pas :
//   • le défaut est VIDE (aucune collection peuplée). Un cas qui veut des données
//     doit les passer — sinon il mesurerait le contexte d'un autre ;
//   • une prop nouvelle est DÉRIVÉE, sans toucher à ce fichier ; et si sa forme
//     n'est pas dérivable (`auth`/`t` en sont), `makeProps` REFUSE de construire
//     les props en la nommant — la suite tombe avec le nom à traiter, au lieu de
//     rendre `undefined` en silence ;
//   • ce qui est déclaré l'est pour le CONTENU (un libellé mesuré, une date qui
//     sert de comparaison), jamais pour faire passer un type.
//
// @param overrides les données du cas — c’est ici que se joue « avec de vraies données »
// ─────────────────────────────────────────────────────────────────────────────
import { createElement, Suspense } from 'react';
import type { ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { MainViewsContext } from '../src/app/mainViewsContext';
import type { MainViewsProps } from '../src/app/mainViewsProps';
import type { AuthState } from '../src/lib/useAuth';
import { translations } from '../src/i18n/translations';
import { assembleProps, deriveContractDefaults } from './views-contract';

// ─── Ce que la dérivation ne peut pas deviner ────────────────────────────────
// Chaque entrée est ici pour son CONTENU, et chaque raison est vérifiable : c'est
// ce qui distingue une déclaration d'un contournement. Les clés sont vérifiées
// contre le contrat par `tests/views-contract.test.ts` — une prop renommée fait
// donc tomber un cas au lieu de laisser un défaut orphelin.

const asyncNoop = async () => {};

/** Un poste ADMIN, connecté : sans profil admin, les vues masquent ce qu'on teste. */
const auth: AuthState = {
  user: null,
  profile: null,
  loading: false,
  error: null,
  isAdmin: true,
  signIn: async () => ({ success: true }),
  signOut: asyncNoop,
  fetchAllProfiles: async () => [],
  updateUserRole: async () => true,
  createStaffUser: async () => ({ success: true }),
  sendPasswordReset: async () => ({ success: true }),
  setUserPassword: async () => ({ success: true }),
};

/**
 * La date de référence des comparaisons d'échéance.
 *
 * `today` n'est pas décoratif : les vues comparent `v.dueDate < today` pour
 * compter les retards. Décisée en chaîne vide, elle rendrait TOUT non en retard,
 * et un cas qui mesure un retard deviendrait vert pour la mauvaise raison.
 */
const referenceDay = '2026-01-15';

export const declaredDefaults: Partial<MainViewsProps> = {
  // Le dictionnaire RÉEL : sans lui aucune vue ne rend de texte, donc un cas qui
  // mesure un libellé mesurerait la chaîne vide.
  t: translations.en,
  // Non dérivable (déclaré ailleurs que dans le module du contrat) — et de toute
  // façon le contenu compte : un poste admin, connecté.
  auth,
  // Deux formateurs qu'un rendu IMPRIME : dérivés, ils rendraient `undefined`,
  // c'est-à-dire le mot « undefined » dans le HTML mesuré.
  formatCurrency: (amount: number) => `${amount ?? 0} XOF`,
  formatDate: (dateStr: string) => dateStr || '',
  // Une date de référence, parce qu'elle sert de SEUIL (voir ci-dessus).
  today: referenceDay,
  // Même idée que `auth` : le poste a le rôle FINANCE. `ExpensesView` ne montre
  // ses actions qu'à ce rôle, donc le `false` de la dérivation ferait mesurer
  // « le bouton est masqué » à des cas qui croient mesurer l'inverse.
  isPromoter: true,
  // `Suspense` enveloppe du contenu : le composant stub de la dérivation rend
  // `null`, donc ce qu'elle enveloppe disparaîtrait du HTML mesuré.
  Suspense: Suspense as never,
  // Idem pour le surlignage : c'est le TEXTE de la ligne qui est mesuré.
  HighlightText: (({ text }: { text?: string }) => <>{text}</>) as never,
};

const derived = deriveContractDefaults();

/**
 * Construit les props COMPLÈTES d'une vue : dérivées du contrat, puis déclarées,
 * puis les données du cas.
 *
 * `assembleProps` refuse de construire quand une prop n'est ni dérivable ni
 * déclarée (voir tests/views-contract.ts) : un défaut `undefined` rendrait une vue
 * à moitié câblée, et un cas vert sur une vue qui n'affiche pas la moitié de ce
 * qu'il croit mesurer est exactement le faux vert que ce dépôt pourchasse.
 */
export function makeProps(overrides: Partial<MainViewsProps> = {}): MainViewsProps {
  return { ...assembleProps(derived, declaredDefaults), ...overrides } as MainViewsProps;
}

/** Renders a view inside the MainViewsContext provider, returning the SSR HTML. */
export function renderWithContext(view: ReactNode, overrides: Partial<MainViewsProps> = {}): string {
  return renderToString(
    createElement(
      MainViewsContext.Provider,
      { value: makeProps(overrides) },
      view
    )
  );
}
