/**
 * ─── LE RESTE DÛ, À L'ÉCHELLE DE L'ÉCOLE ─────────────────────────────────────
 *
 * Le guichet sait, pour UNE famille, ce qui reste sur les mois cochés
 * (`installmentTarget`, `src/lib/paymentInstallments.ts`). L'écran des
 * versements partiels a besoin de la même réponse pour TOUTES les familles, et
 * dans l'ordre où l'école relance : qui doit, sur quel mois, et combien.
 *
 * Ce module ne calcule donc AUCUNE règle à lui : il parcourt les paiements
 * PARTIELS d'un élève (ceux dont `amount < dueAmount`), demande à
 * `installmentTarget` le reste dû de chaque mois déclaré, et ne garde que ce qui
 * reste OUVERT. Un mois que le complément a soldé disparaît de la liste — c'est
 * exactement ce que l'école veut voir : le travail qui reste, pas l'historique.
 *
 * Trois précisions qui évitent de mentir :
 *
 *   • **un versement partiel sans mois déclaré** (une inscription, ou une ligne
 *     d'API) ne peut être rattaché à aucun mois : il est COMPTÉ à part
 *     (`undeclared`) et nommé sur l'écran. Le taire ferait afficher un total plus
 *     petit que la dette réelle ;
 *   • **un élève sans frais déclarés** (`totalDue` à zéro) ne produit aucune
 *     ligne : sans frais, il n'y a pas de reste à calculer, et un zéro inventé
 *     ferait relancer une famille qui ne doit rien — `installmentTarget` rend
 *     déjà `remaining: 0` dans ce cas, on le laisse faire ;
 *   • **un mois soldé** (un reçu `amount >= dueAmount` le déclare) ne remonte
 *     pas : `installmentTarget` ne compte que les versements PARTIELS, et un
 *     mois fermé n'a plus de reste.
 *
 * Le tri est celui de la relance : nom de l'élève, puis mois dans l'ordre du
 * calendrier. Il ne dépend ni de l'ordre de chargement, ni d'un `localeCompare`
 * implicite qui changerait avec la langue du poste.
 */
import { installmentTarget, isPartialPayment } from './paymentInstallments';
import type { InstallmentPaymentLike, InstallmentStudentLike } from './paymentInstallments';

/** La forme minimale d'un élève pour cet agrégat : son nom, ses frais, ses reçus. */
export interface OutstandingStudentLike extends InstallmentStudentLike {
  id: string;
  name: string;
  grade?: string;
  payments?: readonly InstallmentPaymentLike[];
}

/** Un mois sur lequel une famille a commencé à payer, et qui n'est pas soldé. */
export interface OutstandingMonth {
  /** Le mois `YYYY-MM`. */
  month: string;
  /** Les frais de ce mois (francs CFA entiers). */
  due: number;
  /** Ce qui a déjà été versé en partie dessus. */
  paid: number;
  /** Ce qui reste — toujours strictement positif dans cette liste. */
  remaining: number;
  /** La date du dernier versement partiel sur ce mois (`YYYY-MM-DD`), si connue. */
  lastDate?: string;
}

/** Un élève qui doit encore quelque chose, mois par mois. */
export interface OutstandingStudent {
  studentId: string;
  studentName: string;
  grade?: string;
  months: OutstandingMonth[];
  /** La somme des restes de ses mois. */
  remaining: number;
}

export interface OutstandingReport {
  /** Les élèves endettés, triés par nom. */
  students: OutstandingStudent[];
  /** La somme de tous les restes. */
  total: number;
  /** Combien de couples (élève, mois) attendent un complément. */
  monthCount: number;
  /**
   * Les versements partiels qui ne déclarent AUCUN mois : ils pèsent sur la
   * caisse mais ne peuvent pas être rattachés à un mois, donc ils ne sont dans
   * aucun total ci-dessus — et l'écran le dit.
   */
  undeclared: number;
}

/**
 * Les mois qu'un paiement partiel d'élève déclare, avec la date de son dernier
 * geste sur chacun.
 *
 * Sert à savoir QUELS mois examiner — jamais combien ils doivent : le montant
 * vient d'`installmentTarget`, la seule règle du guichet.
 */
function partialMonthsOf(payments: readonly InstallmentPaymentLike[]): Map<string, string | undefined> {
  const months = new Map<string, string | undefined>();
  for (const payment of payments) {
    if (!isPartialPayment(payment)) continue;
    for (const month of payment.months ?? []) {
      const previous = months.get(month);
      const date = payment.date;
      // La date la plus RÉCENTE : c'est elle que la relance cite.
      months.set(month, previous && date && previous > date ? previous : date ?? previous);
    }
  }
  return months;
}

/**
 * Les mois FERMÉS d'un élève : ceux qu'un reçu SOLDÉ déclare.
 *
 * C'est la règle de la couverture (`settledMonthDeclarations`, appliquée par la
 * fiche élève et le rapprochement), lue ici pour une seule raison : un mois
 * fermé n'a plus de reste dû, même si un versement partiel l'a entamé avant.
 * Sans cette lecture, le complément déjà encaissé resterait affiché comme dû —
 * la relance appellerait une famille qui a payé.
 */
function settledMonthsOf(payments: readonly InstallmentPaymentLike[]): Set<string> {
  const settled = new Set<string>();
  for (const payment of payments) {
    if (isPartialPayment(payment)) continue;
    for (const month of payment.months ?? []) settled.add(month);
  }
  return settled;
}

/** L'ordre des mois d'un même élève — `YYYY-MM` se compare comme du texte. */
const byMonth = (a: { month: string }, b: { month: string }): number =>
  a.month < b.month ? -1 : a.month > b.month ? 1 : 0;

/** L'ordre de la relance : le nom, à la française, sans dépendre de la locale du poste. */
const byName = (a: { studentName: string }, b: { studentName: string }): number =>
  a.studentName.localeCompare(b.studentName, 'fr', { sensitivity: 'base' });

/**
 * Le rapport des versements partiels EN COURS : par élève, puis par mois.
 *
 * `students` est la liste que l'application tient déjà — cet agrégat n'ouvre
 * aucune lecture en base, il ne fait que rapprocher ce que le guichet a écrit.
 */
export function outstandingInstallments(
  students: readonly OutstandingStudentLike[],
): OutstandingReport {
  const rows: OutstandingStudent[] = [];
  let undeclared = 0;

  for (const student of students) {
    const payments = student.payments ?? [];
    undeclared += payments.filter((p) => isPartialPayment(p) && (p.months ?? []).length === 0).length;

    const closed = settledMonthsOf(payments);
    const months: OutstandingMonth[] = [];
    for (const [month, lastDate] of partialMonthsOf(payments)) {
      if (closed.has(month)) continue;
      const target = installmentTarget(student, [month]);
      // Un mois déjà soldé par un reçu complet ne remonte pas ; un mois qu'aucun
      // versement partiel n'a entamé non plus (il n'est pas dans la carte).
      if (target.partialPaid <= 0 || target.remaining <= 0) continue;
      months.push({
        month,
        due: target.due,
        paid: target.partialPaid,
        remaining: target.remaining,
        lastDate: lastDate || undefined,
      });
    }
    if (months.length === 0) continue;

    months.sort(byMonth);
    rows.push({
      studentId: student.id,
      studentName: student.name,
      grade: student.grade,
      months,
      remaining: months.reduce((sum, m) => sum + m.remaining, 0),
    });
  }

  rows.sort(byName);
  return {
    students: rows,
    total: rows.reduce((sum, row) => sum + row.remaining, 0),
    monthCount: rows.reduce((sum, row) => sum + row.months.length, 0),
    undeclared,
  };
}

/**
 * Le rapport restreint à ce qu'une recherche nomme — élève ou classe.
 *
 * La comparaison est insensible à la casse ET aux accents (« eleve » trouve
 * « Élève »), comme la palette de commandes : une école tape sans accent.
 */
export function filterOutstanding(
  report: OutstandingReport,
  query: string,
): OutstandingReport {
  const needle = fold(query);
  if (!needle) return report;
  const students = report.students.filter(
    (row) => fold(row.studentName).includes(needle) || fold(row.grade ?? '').includes(needle),
  );
  return {
    students,
    total: students.reduce((sum, row) => sum + row.remaining, 0),
    monthCount: students.reduce((sum, row) => sum + row.months.length, 0),
    undeclared: report.undeclared,
  };
}

/** La forme comparable d'un texte : sans casse, sans accents. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
