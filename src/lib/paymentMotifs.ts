/**
 * ─── LE MOTIF D'UN PAIEMENT ─────────────────────────────────────────────────
 *
 * Le reçu officiel porte une ligne « Motif », sous « Classe ». Jusqu'ici elle
 * imprimait toujours le même mot (« Frais de scolarité »), parce que rien ne
 * disait l'autre : une famille venue régler le DROIT D'INSCRIPTION recevait un
 * reçu qui parlait de scolarité.
 *
 * Ce module est le seul endroit qui décide de la forme de ce choix :
 *
 *   • `PAYMENT_MOTIFS` — les deux motifs, et eux seuls. C'est une LISTE FERMÉE :
 *     un motif nouveau se décide ici, s'ajoute à la contrainte `CHECK` de
 *     `payments.motif` (migration 20261016000000) et se traduit — il ne
 *     s'invente pas depuis un écran ;
 *   • `paymentMotifOf` — la relecture d'une ligne : tout ce qui n'est pas un
 *     motif connu retombe sur le DÉFAUT, jamais sur un trou ;
 *   • `paymentMotifLabel` — le mot du reçu, dans la langue du reçu ;
 *   • `paymentMotifNeedsMonths` — l'INSCRIPTION est un droit d'entrée : elle ne
 *     couvre aucun mois de scolarité, donc exiger un mois pour elle rendrait le
 *     guichet infranchissable le jour de la rentrée ;
 *   • `paymentMotifAuditTag` / `paymentMotifFromDetails` — la mention du motif dans
 *     une phrase du JOURNAL, et sa relecture. L'écrivain et le lecteur du même
 *     gabarit vivent ici, ensemble : deux copies d'une même forme finissent par
 *     diverger, et cette mention-là est une trace qu'on ne peut plus corriger
 *     après coup. C'est elle qui donne son motif à un geste d'AVANT la colonne
 *     `payments.motif` — la seule autre source étant l'instantané `metadata`.
 *
 * La clé STOCKÉE est courte et stable (`scolarite`, `inscription`), jamais un
 * libellé : un mot gravé en base serait faux dans l'autre langue. Le module est
 * PUR — aucune date système, aucun React, aucun accès réseau — et la langue
 * arrive en paramètre, comme dans `paymentMonths.ts`.
 */
import type { TranslationDict } from '../i18n/translations';
import { effectivePaymentMonths, sortPaymentMonths } from './paymentMonths';

/**
 * Les motifs, dans l'ordre où le formulaire les propose : la scolarité d'abord
 * (c'est le geste ordinaire), l'inscription ensuite.
 */
export const PAYMENT_MOTIFS = ['scolarite', 'inscription'] as const;

export type PaymentMotif = (typeof PAYMENT_MOTIFS)[number];

/**
 * Le motif par défaut — celui d'un encaissement ordinaire. C'est AUSSI le motif
 * qu'un reçu réimprime quand la ligne ne déclare rien (`NULL`) : un paiement
 * d'avant la colonne ne change donc pas de papier.
 */
export const DEFAULT_PAYMENT_MOTIF: PaymentMotif = 'scolarite';

/** Vrai pour une valeur qui est un des motifs de la liste fermée. */
export function isPaymentMotif(value: unknown): value is PaymentMotif {
  return typeof value === 'string' && (PAYMENT_MOTIFS as readonly string[]).includes(value);
}

/**
 * La relecture d'une valeur stockée : un motif connu se rend tel quel, tout le
 * reste (absent, `null`, clé d'une version future, chaîne vide) retombe sur le
 * défaut. On ne DEVINE jamais un motif, mais on ne laisse jamais un reçu muet
 * non plus : le papier a une ligne « Motif » à remplir.
 */
export function paymentMotifOf(value: unknown): PaymentMotif {
  return isPaymentMotif(value) ? value : DEFAULT_PAYMENT_MOTIF;
}

/** Le libellé TRADUIT du motif — les mots que la ligne « Motif » du reçu porte. */
export function paymentMotifLabel(motif: PaymentMotif, t: TranslationDict): string {
  return motif === 'inscription' ? t.pdfMotifRegistration : t.pdfMotifTuition;
}

/**
 * L'inscription est un droit d'entrée : elle ne couvre aucun mois. Les mois
 * restent PROPOSÉS pour elle (une famille peut régler les deux le même matin),
 * mais ils ne sont plus exigés.
 */
export function paymentMotifNeedsMonths(motif: PaymentMotif): boolean {
  return motif !== 'inscription';
}

/**
 * La mention du MOTIF dans une phrase du JOURNAL, ou rien.
 *
 * Elle n'est écrite que pour ce qui SORT de l'ordinaire : le geste courant
 * (frais de scolarité) est le motif pré-imprimé du formulaire officiel, et les
 * entrées d'avant la colonne ne portaient rien — un suffixe sur TOUS les
 * encaissements ferait relire autre chose aux lecteurs de l'historique (dont
 * `paymentFactsFromDetails`, qui lit le montant et le reçu dans la phrase).
 *
 * La clé est écrite TELLE QU'ELLE EST STOCKÉE (`inscription`), comme les mois
 * (`2026-09`) : le journal n'a pas de langue, et le libellé traduit
 * (« Inscription ») appartient au reçu — c'est `paymentMotifLabel` qui le rend.
 *
 * Elle vit ici, et non dans les deux chemins qui l'écrivent (en ligne et
 * rejeu) : un même fait ne doit pas se lire de deux façons selon qu'il a
 * attendu la ligne ou non.
 */
export function paymentMotifAuditTag(motif: PaymentMotif | undefined): string {
  return motif && motif !== DEFAULT_PAYMENT_MOTIF ? ` — motif : ${motif}` : '';
}

/**
 * Le gabarit de la mention, tel que `paymentMotifAuditTag` l'écrit.
 *
 * Ancrée sur le tiret cadratin et le mot `motif` : une phrase qui parle de motif
 * sans porter la mention (« Motif du reçu corrigé ») ne rend donc rien. La clé
 * est lue telle qu'elle est STOCKÉE (`inscription`), jamais le libellé traduit —
 * le journal n'a pas de langue.
 */
const MOTIF_IN_PHRASE = /—\s*motif\s*:\s*([A-Za-z_]+)/i;

/**
 * Le motif qu'une phrase de journal déclare, ou `undefined`.
 *
 * `undefined` — et non le défaut : c'est l'ABSENCE qu'il faut rendre, puisque
 * `paymentMotifOf` la traduira plus tard en « reçu d'avant la colonne ». Une clé
 * que ce module ne connaît pas (une version future, une phrase retouchée) vaut
 * aussi l'absence : on ne devine jamais un motif.
 */
export function paymentMotifFromDetails(details: string | null | undefined): PaymentMotif | undefined {
  const matched = MOTIF_IN_PHRASE.exec(String(details ?? ''));
  return matched && isPaymentMotif(matched[1]) ? matched[1] : undefined;
}

/**
 * Les mois que le choix ACTUEL déclare — la règle des mois, motif compris.
 *
 * La scolarité suit la règle de `paymentMonths.ts` : tant que le caissier n'a
 * rien coché, le mois proposé suit la DATE (changer la date d'octobre à novembre
 * doit mettre Novembre sur le reçu, pas laisser Octobre).
 *
 * L'INSCRIPTION, elle, n'a AUCUN mois proposé d'avance : un droit d'entrée ne
 * règle aucun mois de scolarité, et une pastille pré-cochée ferait déclarer
 * Octobre payé par un reçu d'inscription — `monthsCoverage` compterait alors un
 * mois réglé que la famille n'a pas réglé. Seuls les mois RÉELLEMENT cochés
 * comptent, et rien n'est coché par défaut.
 */
export function paymentMotifMonths(
  motif: PaymentMotif,
  selected: readonly string[],
  touched: boolean,
  dateMonth: string,
  options: readonly string[],
): string[] {
  return paymentMotifNeedsMonths(motif)
    ? effectivePaymentMonths(selected, touched, dateMonth, options)
    : sortPaymentMonths(selected);
}

/**
 * Cocher/décocher un mois sous le motif courant — la même base que
 * `paymentMotifMonths`, donc un premier clic sur une inscription coche CE mois
 * et lui seul (il ne repart pas du mois de la date, qu'elle n'a pas coché).
 */
export function toggledPaymentMonthsForMotif(
  motif: PaymentMotif,
  selected: readonly string[],
  touched: boolean,
  dateMonth: string,
  options: readonly string[],
  month: string,
): string[] {
  const base = paymentMotifMonths(motif, selected, touched, dateMonth, options);
  return sortPaymentMonths(base.includes(month) ? base.filter((m) => m !== month) : [...base, month]);
}
