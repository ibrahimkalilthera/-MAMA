/**
 * ─── Les SECTIONS ET MODALES RÉSERVÉES, et leur SEUL droit ──────────────────
 *
 * `src/app/tabRights.ts` a réglé les onglets : un onglet réservé se décide à un
 * seul endroit, et trois surfaces (le rail, la barre mobile, le filet du shell)
 * le DEMANDENT au lieu de l'écrire. Ce module fait la même chose pour ce qui
 * n'est PAS un onglet : une section d'écran, un champ de formulaire, une réponse
 * de MODALE.
 *
 * ─── Le défaut, mesuré le 2026-10-16 ────────────────────────────────────────
 * La même règle de rôle était écrite à la main en QUATRE endroits, et aucune
 * n'était la même fonction :
 *
 *   • `src/components/AppHeader.tsx` — la section « Importer un classeur »
 *     portait `currentUser?.role === 'admin' || currentUser?.role === 'dev' ||
 *     currentUser?.role === 'general_manager'` (la liste de
 *     `public.is_finance_admin()`, écrite en clair) ;
 *   • `src/app/useStudents.ts` — `const canEditScholarship = isPromoter ||
 *     isGeneralManager` (la MÊME liste, recomposée depuis deux booléens) ;
 *   • `src/components/StudentFormModal.tsx` — la même ligne, une seconde fois,
 *     dans la modale qui montre le champ ;
 *   • `src/app/useExpenses.ts` — `const isFinanceAdmin = isPromoter ||
 *     isGeneralManager`, et cette composition gardait la SUPPRESSION d'une
 *     dépense générale, que la base réserve à `public.is_admin()` : plus LARGE
 *     que la politique, et plus large que la corbeille que l'écran montre.
 *
 * Ce qui s'était passé pour l'onglet de l'économe est donc arrivé aux sections :
 * une liste recopiée par surface, dont AUCUNE n'est mesurée. Le jour où la base
 * ouvre ou referme un rôle, l'écran suit — ou ne suit pas — au hasard des
 * copies. « Le prochain écart est déjà écrit » : il suffisait d'ajouter une
 * cinquième surface.
 *
 * ─── Ce que ce module change ────────────────────────────────────────────────
 * Les surfaces ci-dessous ne décident plus : elles DEMANDENT. La table porte,
 * pour chaque surface, son identifiant, le droit qui la garde, l'objet de la
 * BASE que ce droit reflète, et la fonction de gate — la MÊME que le module de
 * droits emploie. Les listes de rôles ne sont pas écrites ici : elles sont
 * IMPORTÉES de `src/lib/*Rights.ts`, où les suites les comparent aux MIGRATIONS
 * dans les deux sens.
 *
 * ─── Ce que ce module n'est PAS ─────────────────────────────────────────────
 * Ce n'est pas un second inventaire des droits métier : `roleRights`
 * (`src/app/roleRights.ts`) dit ce qu'une vue MONTRE pour un geste précis
 * (supprimer, corriger les mois) et `scripts/lib/write-gates.mjs` croise ces
 * portes avec les politiques d'écriture — dans les deux sens. Ici on dit qui
 * peut OUVRIR une surface : une section, un champ, une réponse de modale. Les
 * trois lisent les mêmes listes, chacun une fois, et aucun ne les recopie.
 *
 * ─── Le contrôle qui tient cet invariant ────────────────────────────────────
 * `scripts/check-reserved-tabs.mjs` (branché dans `npm run lint`) refuse,
 * désormais, une LISTE de rôles écrite à la main (`role === 'admin' ||
 * role === 'dev'`, `isPromoter || isGeneralManager`) partout sous `src/`, hors
 * des modules `src/lib/*Rights.ts` — et exige que chaque surface déclarée ici
 * soit DEMANDÉE par au moins un écran (`canUseSection('<section>', …)`), comme
 * il l'exigeait déjà pour les onglets.
 */
import { ADMIN_ROLES, isAdminRole } from '../lib/deleteRights';
import { FINANCE_ADMIN_ROLES, canManageFinanceRecords } from '../lib/payrollRights';

/**
 * Les surfaces (sections, champs, réponses de modale) qui ne s'ouvrent PAS à
 * tout compte connecté.
 *
 * Le type est écrit à la main — et non dérivé de la table — pour qu'une surface
 * réservée sans son entrée, ou une entrée sans sa surface, ne compile pas :
 * c'est `tsc`, pas une convention, qui refuse l'écart. C'est la même garantie
 * que `ReservedTab`.
 */
export type ReservedSection = 'header-import' | 'year-close' | 'scholarship-edit';

export interface ReservedSectionRight {
  /** La surface, telle que l'écran la nomme quand il la demande. */
  section: ReservedSection;
  /**
   * La liste de rôles du droit — IMPORTÉE du module qui la tient, jamais
   * recopiée ici. Le contrôle refuse une liste écrite en clair, et exige que
   * l'identifiant vienne d'un `src/lib/*Rights.ts`.
   */
  roles: readonly string[];
  /**
   * L'objet de la BASE que cette liste reflète, nommé pour le lecteur et pour
   * les suites : c'est ce qui permet de confronter la liste à la migration.
   * Quand l'écran est PLUS ÉTROIT que la politique, c'est écrit ici — un écart
   * déclaré, jamais un silence.
   */
  basis: string;
  /**
   * Le gate, tel que les écrans l'appellent — la MÊME fonction que le module de
   * droits emploie, donc une seule règle compilée.
   */
  canUse: (role: string | null | undefined) => boolean;
}

/**
 * La table, dans l'ordre de l'écran (l'en-tête, l'année, la fiche).
 *
 * `year-close` lit `ADMIN_ROLES` = `public.is_admin()` : fermer une année
 * scolaire écrit `academic_years` et reporte les soldes — c'est l'acte
 * d'administration que `20260809000000_auth_and_rls.sql` réserve à `is_admin()`.
 * `header-import` et `scholarship-edit` lisent `FINANCE_ADMIN_ROLES` =
 * `public.is_finance_admin()` : l'import rejoue des écritures que la base borne
 * aux rôles financiers, et la remise sur frais de scolarité est une décision
 * d'argent — l'écran y est plus ÉTROIT que la policy `students UPDATE`
 * (`auth.role() = 'authenticated'`), ce qui est la seule direction que ce dépôt
 * accepte, et il le dit ici.
 */
export const RESERVED_SECTIONS: readonly ReservedSectionRight[] = [
  {
    section: 'header-import',
    roles: FINANCE_ADMIN_ROLES,
    basis:
      'public.is_finance_admin() (20260902000000) — l’import rejoue des écritures bornées aux rôles financiers',
    canUse: canManageFinanceRecords,
  },
  {
    section: 'year-close',
    roles: ADMIN_ROLES,
    basis: 'public.is_admin() (20260809000000) — academic_years et le report des soldes',
    canUse: isAdminRole,
  },
  {
    section: 'scholarship-edit',
    roles: FINANCE_ADMIN_ROLES,
    basis:
      'public.is_finance_admin() (20260902000000) — l’écran plus ÉTROIT que la policy `students` UPDATE',
    canUse: canManageFinanceRecords,
  },
];

/** Le rôle, réduit à sa forme comparable (l'écriture vient d'une colonne Postgres). */
const norm = (role: string | null | undefined): string => String(role ?? '').trim().toLowerCase();

/** La surface est-elle réservée ? — la question que pose un écran avant de monter un bloc. */
export function isReservedSection(section: string): section is ReservedSection {
  return RESERVED_SECTIONS.some((entry) => entry.section === section);
}

/**
 * Ce rôle peut-il OUVRIR cette surface ?
 *
 * Une surface qui n'est pas dans la table s'ouvre à tout compte connecté : c'est
 * l'écrasante majorité (les tableaux, les listes, les formulaires d'élève ou de
 * parent, le calendrier) et l'écrire ici, une fois, évite un `true` recopié par
 * chaque appelant.
 *
 * Un rôle absent (profil pas encore chargé) n'ouvre AUCUNE surface réservée : le
 * doute ne s'écrit pas comme un droit — la mesure du 2026-10-15 a montré qu'un
 * booléen d'écran seul ouvrait un écran à un poste dont le profil n'était pas lu.
 */
export function canUseSection(section: string, role: string | null | undefined): boolean {
  const entry = RESERVED_SECTIONS.find((candidate) => candidate.section === section);
  if (!entry) return true;
  return (entry.roles as readonly string[]).includes(norm(role));
}
