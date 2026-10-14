/**
 * ─── Le rapport de caisse d'une journée ──────────────────────────────────────
 *
 * La question que pose une caisse à la fermeture n'est pas « que s'est-il passé ? »
 * (c'est l'historique) mais « qui a encaissé quoi AUJOURD'HUI, et qu'est-ce qui a
 * été annulé ? ». Ce module y répond en REGROUPANT les gestes d'une journée par
 * caissier — le seul endroit d'où vient cette réponse est encore le journal
 * d'audit, seul à porter l'utilisateur connecté au moment du geste.
 *
 * Trois décisions, et elles décident de tout :
 *
 *   • **la journée est LOCALE** (`localDayIso`). Une caisse ferme le jour du
 *     poste, pas celui d'UTC : la borne `toISOString()` aurait rangé un
 *     encaissement de 22 h dans la journée suivante pour tout poste à l'est de
 *     Greenwich. Bamako est en UTC+0 — c'est une coïncidence heureuse, pas une
 *     raison de mêler les deux calendriers.
 *   • **le regroupement LIT le filtre de l'écran** (`filterPaymentHistory` avec
 *     les deux bornes du jour) : le rapport ne peut pas retenir une autre journée
 *     que celle que l'historique appellerait « le 6 octobre ».
 *   • **les totaux viennent de `paymentHistorySummary`** — la MÊME fonction que la
 *     ligne de résumé de l'historique, appliquée une fois au jour entier et une
 *     fois par caissier. Deux additions écrites à la main auraient fini par
 *     diverger d'un centime, et c'est le genre d'écart qu'une caisse ne pardonne
 *     pas : le rapport ne peut donc pas contredire l'écran qui l'héberge ;
 *   • **le motif se regroupe comme le caissier, et pour la même raison** — c'est un
 *     fait du REÇU, pas de la personne qui l'a encaissé : une même journée mêle
 *     l'inscription et la scolarité, et une caisse qui ferme doit pouvoir dire ce
 *     que chacune a rapporté. Le regroupement passe par la MÊME
 *     `paymentHistorySummary` (jamais une addition écrite ici), et l'ordre est
 *     déterministe : encaissé décroissant, puis l'ordre de la liste fermée des
 *     motifs (`PAYMENT_MOTIFS`).
 *
 * Ce que le module refuse de faire : deviner un montant absent de l'instantané
 * (les gestes sans montant chiffré sont COMPTÉS à part, par caissier et pour le
 * jour), écarter un geste sans caissier identifiable (il forme son propre groupe
 * au lieu de disparaître d'un total), et additionner une restauration comme une
 * annulation (une restauration remet de l'argent dans la caisse ; elle compte
 * donc avec les encaissements, exactement comme `paymentHistorySummary`).
 *
 * Pur : ni horloge, ni DOM, ni réseau.
 */
import type { PaymentHistoryRow } from './paymentHistory';
import { filterPaymentHistory, paymentHistorySummary } from './paymentHistory';
import { PAYMENT_MOTIFS } from './paymentMotifs';
import type { PaymentMotif } from './paymentMotifs';

/**
 * La journée LOCALE d'un instant, en `AAAA-MM-JJ`.
 *
 * `toISOString().slice(0, 10)` donnerait la journée d'UTC : sur un poste à
 * l'est de Greenwich, un encaissement de fin de soirée basculerait dans le
 * rapport du lendemain. On lit donc les accesseurs locaux.
 */
export function localDayIso(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Ce qu'un caissier a fait de la journée. */
export interface CashierDayTotals {
  /** La clé de regroupement (courriel, à défaut le nom, en minuscules) — jamais affichée. */
  key: string;
  name: string;
  email: string;
  role: string;
  /** Tous les gestes du caissier ce jour-là, annulations et restaurations comprises. */
  count: number;
  collected: number;
  cancelled: number;
  net: number;
  /** Les gestes dont le montant n'est PAS chiffré (voir `paymentHistorySummary`). */
  withoutAmount: number;
}

/** Ce qu'un MOTIF a représenté dans la journée — la même forme qu'un caissier. */
export interface MotifDayTotals {
  /** Le motif du reçu (`scolarite` / `inscription`, voir `lib/paymentMotifs.ts`). */
  motif: PaymentMotif;
  count: number;
  collected: number;
  cancelled: number;
  net: number;
  /** Les gestes dont le montant n'est PAS chiffré (voir `paymentHistorySummary`). */
  withoutAmount: number;
}

/** Le rapport d'une journée — ce que la carte affiche et que le PDF imprime. */
export interface DailyCashReport {
  day: string;
  /** Les gestes du jour, les plus récents d'abord (l'ordre de l'historique). */
  rows: PaymentHistoryRow[];
  /** Les caissiers, encaissé décroissant — le premier est celui qui a le plus pris. */
  cashiers: CashierDayTotals[];
  /**
   * Les motifs du jour, encaissé décroissant — le premier est celui qui a le plus
   * rapporté. Un motif que la journée n'a pas vu n'a PAS de ligne : le rapport
   * décrit ce qui s'est passé, il ne remplit pas un formulaire.
   */
  motifs: MotifDayTotals[];
  /** Les annulations du jour, dans l'ordre des gestes. */
  cancellations: PaymentHistoryRow[];
  count: number;
  collected: number;
  cancelled: number;
  net: number;
  withoutAmount: number;
}

/**
 * Le rapport de caisse d'une journée.
 *
 * @param rows les lignes de l'historique (toutes journées confondues : le jour est choisi ici)
 * @param day la journée `AAAA-MM-JJ` du poste
 */
export function dailyCashReport({ rows, day }: { rows: PaymentHistoryRow[]; day: string }): DailyCashReport {
  const dayRows = filterPaymentHistory(rows, { from: day, to: day });

  // La clé est le COMPTE quand il existe : deux « Awa » ne doivent pas fusionner
  // leurs caisses. Sans compte ni nom, la clé est vide — un groupe à part, jamais
  // une ligne perdue : le total du jour doit rester la somme de ses caissiers.
  const groups = new Map<string, PaymentHistoryRow[]>();
  for (const row of dayRows) {
    const key = (row.actorEmail || row.actorName).trim().toLowerCase();
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const cashiers: CashierDayTotals[] = [...groups.entries()]
    .map(([key, groupRows]) => {
      const head = groupRows[0];
      const summary = paymentHistorySummary(groupRows);
      return {
        key,
        name: head.actorName || '',
        email: head.actorEmail || '',
        role: head.actorRole || '',
        count: summary.count,
        collected: summary.collected,
        cancelled: summary.cancelled,
        net: summary.net,
        withoutAmount: summary.withoutAmount,
      };
    })
    .sort((a, b) => b.collected - a.collected || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Le motif est un fait du REÇU : il se regroupe donc comme le caissier, avec la
  // même addition que la ligne de résumé de l'historique. Une clé est TOUJOURS
  // présente (`PaymentHistoryRow.motif` n'est jamais nul : un reçu d'avant la
  // colonne est ordinaire) — aucun geste ne peut donc s'évaporer d'un sous-total.
  const byMotif = new Map<PaymentMotif, PaymentHistoryRow[]>();
  for (const row of dayRows) {
    const bucket = byMotif.get(row.motif);
    if (bucket) bucket.push(row);
    else byMotif.set(row.motif, [row]);
  }
  const motifs: MotifDayTotals[] = [...byMotif.entries()]
    .map(([motif, groupRows]) => {
      const summary = paymentHistorySummary(groupRows);
      return {
        motif,
        count: summary.count,
        collected: summary.collected,
        cancelled: summary.cancelled,
        net: summary.net,
        withoutAmount: summary.withoutAmount,
      };
    })
    // Deux motifs à égalité d'encaissement gardent l'ordre de la liste FERMÉE :
    // le rapport ne change pas d'ordre d'un poste à l'autre pour un même jour.
    .sort((a, b) => b.collected - a.collected || PAYMENT_MOTIFS.indexOf(a.motif) - PAYMENT_MOTIFS.indexOf(b.motif));

  const totals = paymentHistorySummary(dayRows);

  return {
    day,
    rows: dayRows,
    cashiers,
    motifs,
    cancellations: dayRows.filter((row) => row.action === 'DELETE_PAYMENT'),
    count: totals.count,
    collected: totals.collected,
    cancelled: totals.cancelled,
    net: totals.net,
    withoutAmount: totals.withoutAmount,
  };
}
