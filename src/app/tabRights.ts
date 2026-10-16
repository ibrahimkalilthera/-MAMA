/**
 * ─── Les onglets RÉSERVÉS, et leur SEUL droit ───────────────────────────────
 *
 * Un onglet réservé se décide à TROIS endroits de l'écran : la ligne du rail
 * (`Sidebar`), la ligne de la barre mobile (`MobileNav`) et le filet du shell,
 * qui RAMÈNE l'onglet au tableau de bord quand le rôle n'a pas le droit
 * (`useAuthWelcome`). Ces trois endroits doivent dire la MÊME chose — et c'est
 * exactement ce qui a cassé le 2026-10-15.
 *
 * ─── Le défaut, mesuré ──────────────────────────────────────────────────────
 * Le filet du shell portait sa PROPRE liste : « `!auth.isAdmin` ⇒ settings,
 * audit ET paymentHistory ». La veille c'était vrai ; la migration
 * `20261020000000_econome_payment_history.sql` a ouvert la lecture à l'économe,
 * et le rail a suivi — mais pas le filet. Résultat : l'économe voyait la ligne,
 * cliquait, et l'onglet revenait au tableau de bord dans la même seconde. La
 * fonctionnalité était morte À L'ÉCRAN tout en paraissant ouverte, et AUCUN des
 * cas verts de la veille ne le disait : la garde du rail et celle de l'écran
 * étaient mesurées, la garde du filet ne l'était pas.
 *
 * ─── Ce que ce module change ────────────────────────────────────────────────
 * Les trois endroits ne décident plus : ils DEMANDENT. La table ci-dessous est
 * la seule à porter un onglet réservé, son droit, et la liste de rôles que ce
 * droit lit — et cette liste n'est pas écrite ici : elle vient du module
 * `src/lib/*Rights.ts` qui est le miroir d'une policy ou d'une fonction de la
 * base, là où les tests la comparent à la MIGRATION dans les deux sens. Un
 * onglet neuf, c'est UNE ligne ici — le rail, la barre, le filet et les tests
 * suivent, parce qu'ils itèrent sur cette table au lieu de la recopier.
 *
 * ─── Ce que ce module n'est PAS ─────────────────────────────────────────────
 * Ce n'est pas un second inventaire des droits métier : `roleRights`
 * (`src/app/roleRights.ts`) dit ce qu'un écran MONTRE pour une action (supprimer
 * un reçu, corriger ses mois) ; ici on dit qui peut OUVRIR un onglet. Les deux
 * lisent les mêmes listes, chacun une fois, et aucun ne les recopie.
 *
 * ─── Le contrôle qui tient cet invariant ────────────────────────────────────
 * `scripts/check-reserved-tabs.mjs` (branché dans `npm run lint`) refuse qu'un
 * SECOND gate soit écrit à la main pour l'un de ces onglets : le couple
 * « onglet réservé + comparaison de rôle / appel à un droit » sur une même
 * ligne, un alias de rôle locâle qui garde un bloc d'onglet, une liste d'onglets
 * réservés, ou une liste de rôles écrite en clair dans la table.
 */
import { ADMIN_ROLES, isAdminRole } from '../lib/deleteRights';
import {
  PAYMENT_HISTORY_VIEWER_ROLES,
  canViewPaymentHistory,
} from '../lib/paymentHistoryRights';

/**
 * Les onglets qui ne s'ouvrent PAS à tout compte connecté.
 *
 * Le type est écrit à la main (et non dérivé de la table) pour qu'un onglet
 * réservé sans son entrée — ou une entrée sans son onglet — ne compile pas :
 * c'est `tsc`, pas une convention, qui refuse l'écart.
 */
export type ReservedTab = 'settings' | 'audit' | 'paymentHistory';

export interface ReservedTabRight {
  /** L'onglet, tel que le routeur et les deux navigations le nomment. */
  tab: ReservedTab;
  /**
   * La liste de rôles de ce droit — IMPORTÉE du module qui la tient, jamais
   * recopiée ici. `scripts/check-reserved-tabs.mjs` refuse une liste écrite en
   * clair, et exige que l'identifiant vienne d'un `src/lib/*Rights.ts`.
   */
  roles: readonly string[];
  /**
   * L'objet de la BASE que cette liste reflète, nommé pour le lecteur et pour
   * les tests : c'est ce qui permet de confronter la liste à la migration.
   */
  basis: string;
  /**
   * Le gate, tel que les trois endroits l'appellent — la MÊME fonction que le
   * module de droits emploie, donc une seule règle compilée.
   */
  canOpen: (role: string | null | undefined) => boolean;
  /**
   * Cet onglet LIT le journal des gestes (le seul endroit qui nomme l'encaisseur),
   * donc il faut le RAFRAÎCHIR en l'ouvrant : arriver sur une lecture périmée
   * ferait croire à un geste qui n'y est pas encore.
   *
   * C'est un FAIT de l'onglet, pas un droit — et il vit ici pour la même raison :
   * les deux navigations l'écrivaient chacune de leur côté (`tab === 'audit' ||
   * tab === 'paymentHistory'`), deux listes qui devaient s'accorder. Un onglet
   * neuf qui lira le journal se déclare ici, une fois.
   */
  readsJournal: boolean;
}

/**
 * La table. L'ORDRE est celui de l'écran (rail puis barre) : journal, historique,
 * réglages — il n'est pas cosmétique, les deux navigations l'empruntent.
 *
 * `settings` et `audit` lisent la même liste que `public.is_admin()` — c'est la
 * fonction que la base emploie pour le rail d'administration, et la policy
 * « Admins can view audit logs » (`20260814000000`) écrit la même liste, en
 * clair : `role IN ('admin', 'dev')`. `paymentHistory` lit le droit de LIRE le
 * journal des gestes de caisse (`public.is_payment_history_viewer()`), qui
 * inclut l'économe depuis le 2026-10-15.
 */
export const RESERVED_TABS: readonly ReservedTabRight[] = [
  {
    tab: 'audit',
    roles: ADMIN_ROLES,
    basis: 'policy « Admins can view audit logs » (20260814000000)',
    canOpen: isAdminRole,
    readsJournal: true,
  },
  {
    tab: 'paymentHistory',
    roles: PAYMENT_HISTORY_VIEWER_ROLES,
    basis: 'public.is_payment_history_viewer() (20261020000000)',
    canOpen: canViewPaymentHistory,
    readsJournal: true,
  },
  {
    tab: 'settings',
    roles: ADMIN_ROLES,
    basis: 'public.is_admin() (20260809000000)',
    canOpen: isAdminRole,
    readsJournal: false,
  },
];

/** Le rôle, réduit à sa forme comparable (l'écriture vient d'une colonne Postgres). */
const norm = (role: string | null | undefined): string => String(role ?? '').trim().toLowerCase();

/** L'onglet est-il réservé ? — la question que pose le filet du shell. */
export function isReservedTab(tab: string): tab is ReservedTab {
  return RESERVED_TABS.some((entry) => entry.tab === tab);
}

/**
 * Ce rôle peut-il OUVRIR cet onglet ?
 *
 * Un onglet qui n'est pas dans la table s'ouvre à tout compte connecté : c'est
 * l'écrasante majorité (élèves, parents, paie, dépenses, calendrier, notes,
 * archives, reçus muets) et l'écrire ici, une fois, évite un `true` recopié par
 * chaque appelant.
 *
 * Un rôle absent (profil pas encore chargé) n'ouvre AUCUN onglet réservé : le
 * doute ne s'écrit pas comme un droit — la mesure du 2026-10-15 a montré qu'un
 * `isAdmin` seul ouvrait l'historique à un poste dont le profil n'était pas lu.
 */
export function canOpenTab(tab: string, role: string | null | undefined): boolean {
  const entry = RESERVED_TABS.find((candidate) => candidate.tab === tab);
  if (!entry) return true;
  return (entry.roles as readonly string[]).includes(norm(role));
}

/**
 * Ce qu'il faut faire AVANT d'ouvrir un onglet : recharger le journal s'il le lit.
 *
 * Les deux navigations l'appellent au lieu de porter leur propre liste — c'est ce
 * qui a rendu la ligne `if (tab === 'audit' || tab === 'paymentHistory')` de la
 * barre mobile inutile, et le contrôle refuse désormais qu'une telle liste
 * revienne.
 */
export function beforeOpenTab(tab: string, fetchAuditLogs?: () => void): void {
  if (RESERVED_TABS.some((entry) => entry.tab === tab && entry.readsJournal)) fetchAuditLogs?.();
}
