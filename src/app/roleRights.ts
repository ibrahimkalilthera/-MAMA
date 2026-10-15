/**
 * ─── Les droits de l'ÉCRAN, lus UNE fois ────────────────────────────────────
 *
 * Chaque liste de rôles vit dans `src/lib/*Rights.ts`, où elle est le miroir
 * d'une policy ou d'une fonction de la base (`public.is_admin()`,
 * `public.is_payment_deleter()`, `public.is_finance_admin()`…) et où les tests la
 * comparent à la MIGRATION, dans les deux sens. Ce module-ci est le SEUL endroit
 * qui les LIT, et il les rend ensemble parce que les vues les reçoivent ensemble
 * (`MainViewsProps` / `AppModalsProps`) : le rôle sort de la session et ne change
 * pas d'un droit à l'autre, donc une lecture suffit et quatre lectures éparpillées
 * racontaient la même chose quatre fois.
 *
 * Deux usages, et ils ne se confondent pas :
 *   • ce qui est MONTRÉ — une action que la base refuserait n'existe pas à
 *     l'écran (les vues ne reçoivent que ces booléens) ;
 *   • ce qui est ACCEPTÉ — `usePayroll` relit `canDeleteSalaryPayment` avant
 *     d'agir, parce qu'un booléen d'écran ne décide pas d'un droit : il peut
 *     n'avoir pas été rafraîchi depuis un changement de rôle en base.
 *
 * Le prix d'une erreur ici est celui que `src/lib/deleteRights.ts` décrit :
 * le bouton s'affiche, PostgREST répond 200 avec un corps vide, rien n'est
 * supprimé et l'écran l'annonce quand même. C'est pour cette raison que les
 * listes ne sont pas écrites ici — ce module ne fait que les interroger.
 */
import { canDeleteRecords } from '../lib/deleteRights';
import { canDeletePayments, canUpdatePaymentMonths } from '../lib/paymentRights';
import { canDeleteSalaryPayments } from '../lib/payrollRights';

/** Les droits d'un rôle, tels que les vues les lisent. */
export interface RoleRights {
  /** Détruire une ligne des tables admin — `public.is_admin()` (admin, dev). */
  canDelete: boolean;
  /** Détruire un REÇU — `public.is_payment_deleter()` (admin, dev, économe). */
  canDeletePayment: boolean;
  /**
   * Renseigner les MOIS d'un reçu déjà enregistré — policy « Admin update
   * payments » : plus ÉTROITE que la suppression. L'économe corrige un reçu
   * fautif (il a `canDeletePayment`) sans pouvoir réécrire ses mois.
   */
  canEditPaymentMonths: boolean;
  /**
   * Retirer un SALAIRE fautif — `public.is_finance_admin()` (admin, dev,
   * Gestionnaire Principal). L'économe enregistre la paie sans pouvoir la
   * détruire : écrire et détruire ne sont pas le même droit.
   */
  canDeleteSalaryPayment: boolean;
}

/** Les quatre droits de l'écran pour un rôle donné, en une seule lecture. */
export function roleRights(role: string | null | undefined): RoleRights {
  return {
    canDelete: canDeleteRecords(role),
    canDeletePayment: canDeletePayments(role),
    canEditPaymentMonths: canUpdatePaymentMonths(role),
    canDeleteSalaryPayment: canDeleteSalaryPayments(role),
  };
}
