/**
 * ─── LES VERSEMENTS PARTIELS ─────────────────────────────────────────────────
 *
 * Une famille qui ne peut pas régler les frais d'un mois d'un coup en verse une
 * PARTIE au guichet, puis revient avec le complément. Sans cette brique, la
 * seule trace du premier geste était son montant : le reçu ne disait pas que le
 * versement était partiel, ni ce qu'il restait à payer — et, plus grave, la
 * fiche de l'élève fermait le mois comme s'il était réglé, si bien que le
 * complément était refusé le jour où la famille revenait.
 *
 * Trois faits, et un seul endroit pour les décider :
 *
 *   • **`due` (le montant attendu)** — les frais des mois que ce geste déclare,
 *     au moment de la saisie : `total_due × (1 − bourse)` divisés par les MOIS
 *     DE L'ANNÉE scolaire. L'année n'en compte pas douze partout : l'école règle
 *     sa plage (`academic_years.start_month`/`end_month`), septembre→juin le
 *     plus souvent, octobre→juin parfois, jusqu'en juillet ailleurs. Diviser par
 *     douze réclamait donc au guichet un dixième de trop à une école de dix
 *     mois. Le nombre arrive en PARAMÈTRE (`monthsInYear`) : ce module reste pur,
 *     et le repli à douze vaut pour une année dont la plage n'est pas lisible.
 *     C'est ce nombre qui part en base (`payments.due_amount`, migration
 *     20261109000000) et qui rend un reçu réimprimable six mois plus tard, même
 *     si les frais de l'élève ont changé depuis ;
 *   • **`remaining` (le reste dû)** — `due` moins la somme des versements
 *     PARTIELS déjà reçus sur ces mêmes mois. C'est ce que le guichet affiche,
 *     et ce que le bouton « Solde » propose ;
 *   • **`isPartialPayment`** — `amount < due_amount`, en francs CFA entiers (la
 *     monnaie n'a pas de centimes : comparer des flottants ferait un « partiel »
 *     d'un arrondi de 10⁻¹²).
 *
 * La règle qui en découle, et que la fiche élève applique : **un versement
 * partiel ne ferme aucun mois**. Un mois ne se dit réglé que par un reçu qui
 * l'a SOLDÉ — sinon le complément serait refusé, et la famille qui a payé
 * deux fois se verrait répondre que le mois l'est déjà.
 *
 * `due_amount` absent (ligne d'avant la colonne, import, inscription) veut dire
 * « non déclaré » : le paiement compte comme soldé, comme avant, et le reçu ne
 * gagne aucune mention. C'est le contrat des colonnes `months` et `motif` avant
 * elle — un reçu déjà imprimé ne change pas d'un caractère.
 *
 * Le module est PUR : ni React, ni réseau, ni date système. La mise en forme de
 * la monnaie arrive en paramètre (`fmt`), parce que le PDF écrit « 12 500 FCFA »
 * et l'écran écrit l'espace insécable de `formatCurrency` — deux rendus, une
 * seule règle.
 */
import type { TranslationDict } from '../i18n/translations';

/**
 * Le diviseur de REPLI des frais annuels : douze mois.
 *
 * Ce n'est plus la règle — la règle est la plage réglée par l'école, passée en
 * `monthsInYear`. C'est ce que vaut une année dont la plage ne se lit pas
 * (ligne d'avant les colonnes `start_month`/`end_month`, année inconnue) : le
 * comportement d'avant, plutôt qu'un refus de calculer un reste dû.
 */
export const DEFAULT_MONTHS_IN_YEAR = 12;

/** La forme minimale d'un paiement dont ce module a besoin. */
export interface InstallmentPaymentLike {
  id?: string;
  amount: number;
  /**
   * Le montant que CE geste était censé régler (`payments.due_amount`).
   * Absent = « non déclaré » : le geste vaut soldé, et le reçu reste celui
   * d'avant cette fonctionnalité.
   */
  dueAmount?: number;
  months?: readonly string[];
  date?: string;
  receiptNumber?: string;
}

/** La forme minimale d'un élève : de quoi calculer les frais d'un mois, et ses reçus. */
export interface InstallmentStudentLike {
  totalDue: number;
  scholarshipDiscount?: number;
  payments?: readonly InstallmentPaymentLike[];
}

/**
 * `true` quand un paiement ne couvre qu'une PARTIE de ce qu'il devait régler.
 *
 * La comparaison est faite en francs CFA entiers : `NUMERIC` en base et un
 * `number` en JavaScript ne se comparent pas au bit près, et un arrondi de
 * 10⁻¹² ne doit pas transformer un paiement soldé en versement partiel.
 */
export function isPartialPayment(payment: InstallmentPaymentLike): boolean {
  if (payment.dueAmount === undefined || payment.dueAmount === null) return false;
  const due = Math.round(Number(payment.dueAmount));
  const paid = Math.round(Number(payment.amount));
  if (!Number.isFinite(due) || !Number.isFinite(paid)) return false;
  return paid < due;
}

/**
 * Les frais d'UN mois : les frais annuels nets de bourse, divisés par les mois
 * de l'ANNÉE SCOLAIRE de l'école (`monthsInYear`) — dix pour septembre→juin,
 * onze pour octobre→juin, douze seulement si l'année va jusqu'en août.
 *
 * Zéro quand l'élève n'a pas de frais déclarés — et zéro n'est pas une erreur :
 * un élève importé sans `total_due` ne doit pas produire des versements partiels
 * imaginaires. Un `monthsInYear` absurde (0, négatif, illisible) retombe sur le
 * repli plutôt que de rendre `Infinity` : un reste dû infini serait pire qu'un
 * reste dû à l'ancienne.
 */
export function monthlyFee(
  student: InstallmentStudentLike,
  monthsInYear: number = DEFAULT_MONTHS_IN_YEAR,
): number {
  const total = Number(student.totalDue) || 0;
  const discountPct = Number(student.scholarshipDiscount) || 0;
  const net = total * (1 - discountPct / 100);
  const count = Number(monthsInYear);
  const divisor = Number.isFinite(count) && count >= 1 ? Math.trunc(count) : DEFAULT_MONTHS_IN_YEAR;
  return net > 0 ? net / divisor : 0;
}

/**
 * Ce que le guichet doit afficher pour un choix de mois : les frais de ces
 * mois, ce qui a déjà été versé en partie dessus, et ce qui reste.
 *
 * Un versement partiel déclare les mois qu'il entame ; c'est cette liste qui
 * permet de lui rendre son reste. Un versement partiel qui ne déclare aucun
 * mois (cas d'une inscription, qui n'en déclare pas) ne retire rien à personne.
 */
export interface InstallmentTarget {
  /** Les mois du choix, dans l'ordre reçu. */
  months: string[];
  /** Les frais des mois choisis (francs CFA entiers). */
  due: number;
  /** La somme des versements PARTIELS déjà reçus sur ces mois. */
  partialPaid: number;
  /** Ce qui reste à régler sur ces mois — jamais négatif. */
  remaining: number;
}

export function installmentTarget(
  student: InstallmentStudentLike,
  months: readonly string[],
  monthsInYear: number = DEFAULT_MONTHS_IN_YEAR,
): InstallmentTarget {
  const chosen = [...months];
  const due = Math.round(monthlyFee(student, monthsInYear) * chosen.length);
  const partialPaid = (student.payments ?? [])
    .filter(isPartialPayment)
    .filter((p) => (p.months ?? []).some((m) => chosen.includes(m)))
    .reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  return {
    months: chosen,
    due,
    partialPaid: Math.round(partialPaid),
    remaining: Math.max(0, due - Math.round(partialPaid)),
  };
}

/**
 * Les déclarations de mois qui comptent pour « ce mois est réglé » : celles des
 * paiements SOLDÉS, et elles seules.
 *
 * C'est le point de passage unique pour la couverture des mois
 * (`monthsCoverage` / `paymentMonthHistory`) : un versement partiel déclare ses
 * mois — c'est ce qui permet de lui rendre son reste — mais il ne les ferme
 * pas. Écrite ailleurs, la règle finirait par diverger, et le guichet
 * refuserait le complément qu'il vient lui-même de proposer.
 */
export function settledMonthDeclarations(
  payments: readonly InstallmentPaymentLike[],
): (readonly string[] | undefined)[] {
  return payments.filter((p) => !isPartialPayment(p)).map((p) => p.months);
}

/**
 * La mention que le reçu ajoute à sa ligne « Motif » — vide quand il n'y a rien
 * à dire, et c'est le cas de TOUS les reçus ordinaires : sans versement partiel
 * déclaré, le papier officiel reste exactement celui d'avant.
 *
 *   • versement partiel → « versement partiel — reste à payer 12 500 FCFA » ;
 *   • reçu qui solde des versements partiels antérieurs → « solde — total réglé
 *     25 000 FCFA », le total étant la somme des versements partiels et de
 *     celui-ci. C'est le chiffre que la famille cherche : ce qu'elle a payé en
 *     tout pour ces mois.
 */
export function installmentReceiptNote(
  payment: InstallmentPaymentLike,
  payments: readonly InstallmentPaymentLike[],
  t: TranslationDict,
  fmt: (amount: number) => string,
): string {
  const due = payment.dueAmount;
  if (due === undefined || due === null) return '';
  const amount = Math.round(Number(payment.amount) || 0);

  if (isPartialPayment(payment)) {
    const remaining = Math.max(0, Math.round(Number(due)) - amount);
    return t.receiptPartialNote.replace('{amount}', fmt(remaining));
  }

  // Reçu SOLDÉ : il ne porte une mention que s'il termine quelque chose — un
  // versement partiel antérieur sur les mêmes mois.
  const months = payment.months ?? [];
  const earlier = payments.filter(
    (p) =>
      p !== payment &&
      isPartialPayment(p) &&
      (p.months ?? []).some((m) => months.includes(m)),
  );
  if (earlier.length === 0) return '';
  const total = earlier.reduce((sum, p) => sum + (Number(p.amount) || 0), amount);
  return t.receiptSettledNote.replace('{amount}', fmt(Math.round(total)));
}
