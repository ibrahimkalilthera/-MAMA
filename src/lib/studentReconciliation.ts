/**
 * ─── L'ÉTAT DE RAPPROCHEMENT D'UN ÉLÈVE ─────────────────────────────────────
 *
 * « Où en est cet élève ? » — la question que la famille pose au guichet, et
 * celle que l'école doit pouvoir répondre sur un papier : quels mois de
 * l'année scolaire sont RÉGLÉS, quels mois restent, et combien il reste à
 * verser. La fiche élève montre déjà la bande des mois (`monthsCoverage`) ;
 * l'état de rapprochement en fait un DOCUMENT — l'avis remis ou relancé.
 *
 * Tout vient de `paymentMonths` : `paymentMonthHistory` pour les mois réglés
 * AVEC les reçus qui les déclarent, `monthsCoverage` pour les mois restants et
 * le compte des reçus MUETS. Une seule définition de « couvert » dans tout le
 * dépôt, donc l'état ne peut pas nommer un mois réglé que la fiche ignorerait.
 *
 * ─── La règle qui fait vivre ce module : un muet n'est pas un impayé ────────
 * Un reçu qui ne déclare AUCUN mois (antérieur à la colonne `payments.months`,
 * import, envoi sans cocher) ne dit pas ce qu'il couvre : sa couverture est
 * INCONNUE, pas nulle. Compter ses mois comme impayés reviendrait à réclamer
 * une famille qui a payé — le pire papier qu'une école puisse envoyer.
 *
 * C'est pourquoi la phrase des mois impayés N'EST PAS écrite par l'écran : elle
 * est montée ICI, par `reconciliationDue`, qui REFUSE la formule sèche dès
 * qu'un reçu muet existe et la remplace par sa variante « sous réserve », avec
 * le nombre de reçus à vérifier. Il n'existe donc aucun chemin de code — écran,
 * aperçu ou jumeau imprimé — capable d'annoncer « encore dus » à une famille
 * dont les reçus n'ont pas encore été renseignés.
 *
 * Le module est PUR : ni React, ni base, ni date système. La langue arrive en
 * paramètre (`ReconciliationWords`), comme pour les mots du reçu.
 */
import { monthsCoverage, paymentMonthHistory } from './paymentMonths';
import type { PaymentLike, PaymentMonthFact } from './paymentMonths';

/**
 * Ce que l'état a besoin de lire sur l'élève — la même forme MINIMALE que
 * `PaymentLike` : la fiche (`Student`) s'y conforme sans conversion, et les
 * tests n'ont pas à monter une fiche entière pour éprouver une règle d'argent.
 */
export interface ReconciliationStudent {
  payments: readonly PaymentLike[];
  totalDue: number;
  amountPaid: number;
  scholarshipDiscount?: number;
}

export interface StudentReconciliation {
  /**
   * Les douze mois de l'année jugée, en `YYYY-MM`. VIDE quand l'année est
   * illisible : sans année, il n'y a pas de mois à nommer — jamais de mois
   * inventé (voir `academicYearMonths`).
   */
  yearMonths: string[];
  /** Les mois RÉGLÉS, chacun avec les reçus qui le déclarent. */
  covered: PaymentMonthFact[];
  /** Les mois qu'AUCUN reçu ne déclare — la matière de la phrase des dus. */
  due: string[];
  /** Combien de reçus ne déclarent AUCUN mois : leur couverture est INCONNUE. */
  undeclared: number;
  /** Le dû de l'année, remise déduite. */
  totalDue: number;
  /** Versé, tel que la fiche le porte. */
  paid: number;
  /** Reste à verser — jamais négatif (une famille à jour ne doit rien). */
  balance: number;
}

/**
 * L'état complet d'un élève pour une année scolaire donnée.
 *
 * `yearMonths` est passé par l'appelant — lu sur l'année de la FICHE, l'année
 * active de l'application en recours, et par `academicYearMonths` : la même
 * chaîne que la fiche et l'écran de saisie, donc le même jugement.
 */
export function studentReconciliation(
  student: ReconciliationStudent,
  yearMonths: readonly string[],
): StudentReconciliation {
  const history = paymentMonthHistory(student.payments, yearMonths);
  const coverage = monthsCoverage(student.payments.map((p) => p.months), yearMonths);
  const discount = student.scholarshipDiscount || 0;
  // Le dû NET est celui que la fiche affiche déjà (remise déduite) : deux
  // formules d'argent pour le même élève finiraient par diverger d'un centime,
  // et c'est la famille qui le verrait.
  const totalDue = student.totalDue * (1 - discount / 100);
  return {
    yearMonths: [...yearMonths],
    covered: history.facts,
    due: coverage.missing,
    undeclared: history.undeclared,
    totalDue,
    paid: student.amountPaid,
    // Un solde négatif n'est pas une dette : on borne à 0, comme le fait la
    // suppression d'un paiement (`deletePayment`).
    balance: Math.max(0, totalDue - student.amountPaid),
  };
}

/**
 * Les mots dont la phrase des mois dus a besoin — fournis par l'appelant, comme
 * pour les mots du reçu : le module ne va pas chercher la langue lui-même.
 */
export interface ReconciliationWords {
  /** Le libellé d'un mois (« Octobre », « October »). */
  label: (ym: string) => string;
  /** « Encore dus : {months}. » — la formule SÈCHE, réservée aux dossiers complets. */
  dueLine: string;
  /** « {months} — sous réserve : {count} reçu(s) ne déclarent aucun mois… ». */
  dueReserved: string;
  /** « Tous les mois de l'année sont couverts. » */
  complete: string;
  /** L'année scolaire illisible : les mois ne peuvent pas être listés. */
  noYear: string;
}

export interface ReconciliationDue {
  /** Les mois qu'aucun reçu ne déclare, en `YYYY-MM` (vide si rien à dire). */
  months: string[];
  /** La phrase EXACTE à écrire — jamais « encore dus » sans le recul qui s'impose. */
  line: string;
  /** Vrai quand la phrase porte la réserve des reçus muets. */
  reserved: boolean;
}

/**
 * Les mois encore dus, DITS — et la garantie que la formule sèche n'est jamais
 * employée quand un reçu muet rend la couverture incertaine.
 *
 *   • année illisible → rien à nommer, et on le dit ;
 *   • tout est déclaré → la phrase de couverture complète ;
 *   • un reçu muet existe → « sous réserve », avec le nombre de reçus à vérifier :
 *     les mois listés sont ceux qu'AUCUN reçu ne déclare, jamais des mois
 *     « impayés » qu'un papier non renseigné couvrirait peut-être ;
 *   • sinon → la liste simple.
 *
 * `reserved` est exposé pour que l'écran puisse marquer le fait (couleur,
 * arrêt de la relance) sans relire la phrase, et pour qu'un test le verrouille.
 */
export function reconciliationDue(
  rec: StudentReconciliation,
  words: ReconciliationWords,
): ReconciliationDue {
  if (rec.yearMonths.length === 0) return { months: [], line: words.noYear, reserved: false };
  if (rec.due.length === 0) return { months: [], line: words.complete, reserved: false };
  const months = rec.due.map(words.label).join(', ');
  if (rec.undeclared > 0) {
    return {
      months: [...rec.due],
      line: words.dueReserved.replace('{months}', months).replace('{count}', String(rec.undeclared)),
      reserved: true,
    };
  }
  return { months: [...rec.due], line: words.dueLine.replace('{months}', months), reserved: false };
}
