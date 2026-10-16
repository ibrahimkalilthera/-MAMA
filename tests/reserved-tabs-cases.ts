/**
 * ─── Les onglets réservés, vus des TROIS surfaces ───────────────────────────
 *
 * Un onglet réservé se décide à trois endroits (rail, barre mobile, filet du
 * shell) et ces trois endroits doivent dire la même chose. Les suites de rendu
 * (`sidebar-nav-alignment`, `mobile-nav`, `auth-welcome`) itèrent donc sur cette
 * liste au lieu d'écrire trois fois les mêmes rôles : un onglet neuf est mesuré
 * partout sans qu'un cas soit ajouté à la main — c'est « et les suivants » de la
 * demande, tenue par une boucle et non par une intention.
 *
 * Ce qui reste à DÉCLARER ici est le libellé de l'onglet (la traduction que
 * l'écran affiche), et le type l'exige : `Record<ReservedTab, string>` ne compile
 * pas si un onglet réservé n'a pas le sien. Un onglet ajouté à la table et oublié
 * ici est donc une ERREUR DE COMPILATION, jamais un onglet silencieusement sauté.
 *
 * Les rôles ne sont pas déclarés : ils viennent de la table (`entry.roles`), elle-
 * même importée des modules de droits (`src/lib/*Rights.ts`). Le POOL, lui, est le
 * vocabulaire des rôles de l'application (`AppRole`) : les deux contrôles de
 * cohérence ci-dessous refusent une table dont un rôle sortirait de ce
 * vocabulaire (la suite ne saurait plus l'essayer) ou dont la liste couvrirait
 * tous les rôles (elle ne garderait alors plus rien, et le cas « rôle refusé »
 * disparaîtrait au lieu de rester mesuré).
 */
import { RESERVED_TABS } from '../src/app/tabRights';
import type { ReservedTab } from '../src/app/tabRights';
import { translations } from '../src/i18n/translations';
import type { AppRole } from '../src/lib/useAuth';

const t = translations.fr;

/** Le vocabulaire des rôles de l'application — le même que `AppRole`. */
export const ROLE_POOL: readonly AppRole[] = [
  'admin',
  'dev',
  'general_manager',
  'econome',
  'staff',
];

/** Le libellé AFFICHÉ par chaque surface pour un onglet réservé. */
const LABELS: Record<ReservedTab, string> = {
  audit: t.auditTrail,
  paymentHistory: t.paymentHistory,
  settings: t.navSettings,
};

export interface ReservedTabCase {
  tab: ReservedTab;
  /** Le libellé traduit que le rail et la barre rendent pour cet onglet. */
  label: string;
  /** La liste de rôles du droit, telle que la table l'a importée. */
  roles: readonly string[];
  /** Un rôle du vocabulaire que le droit ADMET. */
  roleWithRight: AppRole;
  /** Un rôle du vocabulaire que le droit REFUSE. */
  roleWithoutRight: AppRole;
}

export const RESERVED_TAB_CASES: readonly ReservedTabCase[] = RESERVED_TABS.map((entry) => {
  const label = LABELS[entry.tab];
  if (!label || !String(label).trim()) {
    throw new Error(`onglet réservé sans libellé affiché : ${entry.tab} (tests/reserved-tabs-cases.ts)`);
  }
  const roles = entry.roles as readonly string[];
  const admitted = ROLE_POOL.filter((role) => roles.includes(role));
  const refused = ROLE_POOL.filter((role) => !roles.includes(role));
  if (admitted.length === 0) {
    throw new Error(
      `aucun rôle du vocabulaire n'a le droit d'ouvrir ${entry.tab} : ${roles.join(', ')} n'est pas dans AppRole`,
    );
  }
  if (refused.length === 0) {
    throw new Error(
      `aucun rôle du vocabulaire n'est refusé par ${entry.tab} : ce droit ne garde rien, il ne devrait pas être une entrée réservée`,
    );
  }
  return {
    tab: entry.tab,
    label: String(label),
    roles,
    roleWithRight: admitted[0],
    roleWithoutRight: refused[0],
  };
});

/** Un onglet NON réservé, pour les cas négatifs (il s'ouvre à tout compte connecté). */
export const OPEN_TAB = 'students';
