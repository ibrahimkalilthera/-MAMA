/**
 * ─── LES MOIS PAYÉS ─────────────────────────────────────────────────────────
 *
 * Un paiement porte une DATE (le jour où l'argent est entré) ; il ne dit pas
 * quels mois de scolarité l'argent couvre. Une famille qui règle octobre,
 * septembre et décembre le même matin n'a qu'un reçu : la date seule y fait
 * lire « Octobre », et les deux autres mois disparaissent du papier que la
 * famille garde.
 *
 * Ce module est le seul endroit qui décide de la forme de ce choix :
 *
 *   • `academicYearMonths` — les douze mois d'une année scolaire ;
 *   • `sortPaymentMonths` — l'ordre du calendrier, sans doublon ;
 *   • `paidMonthsShape` — « aucun », « un seul », « plage », « liste » ;
 *   • `formatPaidMonths` — ce que la ligne « Mois » du reçu écrit.
 *
 * Deux décisions valent d'être dites :
 *
 *   1. **Le mois stocké est `YYYY-MM`, jamais un libellé.** « Septembre » gravé
 *      en base deviendrait faux dans un reçu anglais, et « sep » ne dirait pas
 *      de quelle année. `2026-09` se trie, se compare et se traduit à
 *      l'impression — c'est `paymentMonthLabel` qui rend le mot.
 *   2. **L'année scolaire commence en SEPTEMBRE.** Un `getMonth()` nu rangerait
 *      septembre en neuvième position d'une année civile qui n'existe pas ici,
 *      et une liste triée par mois civil mettrait octobre AVANT septembre :
 *      d'où le rang absolu (`année × 12 + mois`), qui traverse aussi le passage
 *      décembre → janvier sans se tromper.
 *
 * Le module est PUR : aucune date système, aucun React, aucun accès réseau. La
 * langue arrive en paramètre (`PaymentMonthLabel` / `PaidMonthsWords`), ce qui
 * permet d'essayer le même choix en français et en anglais.
 */
import type { Language, TranslationDict } from '../i18n/translations';
import { formatCurrency, formatDateLang } from './formatters';

/** Septembre — le premier mois de l'année scolaire malienne (0 = janvier). */
const SCHOOL_FIRST_MONTH = 8;

/**
 * Les douze clés i18n des mois, dans l'ordre du calendrier civil : l'INDEX du
 * tableau EST le mois (0 = janvier), comme le `['jan', …][monthIdx]` déjà
 * utilisé par le reçu et par `getMonthName`.
 */
export const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
] as const;
export type MonthKey = (typeof MONTH_KEYS)[number];

/** La forme STOCKÉE d'un mois : `YYYY-MM`, zéro de tête compris. */
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Vrai pour un `YYYY-MM` réel — la forme sous laquelle un mois se stocke. */
export function isPaymentMonth(value: string): boolean {
  return MONTH_PATTERN.test(value);
}

/** Année + mois (0 = janvier) d'un `YYYY-MM`, ou null. */
function parts(ym: string): { year: number; month: number } | null {
  const m = MONTH_PATTERN.exec(ym);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]) - 1 };
}

/**
 * Rang absolu d'un mois (`année × 12 + mois`). C'est lui qui trie et qui décide
 * de la continuité : deux mois consécutifs ont des rangs qui se suivent, que la
 * paire franchisse ou non le 31 décembre.
 */
function rank(ym: string): number | null {
  const p = parts(ym);
  return p ? p.year * 12 + p.month : null;
}

/**
 * Les douze mois d'une année scolaire : « 2026-2027 » → septembre 2026 …
 * août 2027, en `YYYY-MM`.
 *
 * Une valeur illisible rend une liste VIDE, et c'est voulu : proposer des mois
 * inventés ferait cocher une famille sur une année qui n'existe pas. Le
 * formulaire cache alors son champ, et le reçu retombe sur le mois de la date
 * (comportement d'avant ce module). Le séparateur `-` ou `/` est accepté, comme
 * dans `academicYearWindow`.
 */
export function academicYearMonths(academicYear: string | undefined): string[] {
  if (!academicYear) return [];
  const m = academicYear.match(/(\d{4})[-/](\d{4})/);
  if (!m) return [];
  const startYear = Number(m[1]);
  return Array.from({ length: 12 }, (_, i) => {
    const month = (SCHOOL_FIRST_MONTH + i) % 12;
    const year = startYear + Math.floor((SCHOOL_FIRST_MONTH + i) / 12);
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  });
}

/**
 * Trie dans l'ordre du calendrier, retire les doublons et écarte ce qui n'est
 * pas un mois : un choix bricolé (case double, valeur d'une ancienne version)
 * ressort propre, et ne fait jamais échouer un reçu.
 */
export function sortPaymentMonths(months: readonly string[]): string[] {
  const ranked = months
    .map((ym) => ({ ym, r: rank(ym) }))
    .filter((e): e is { ym: string; r: number } => e.r !== null)
    .sort((a, b) => a.r - b.r);
  const out: string[] = [];
  for (const { ym } of ranked) if (!out.includes(ym)) out.push(ym);
  return out;
}

/** La clé i18n d'un mois — « sep » pour 2026-09 ; null si le mois est illisible. */
export function monthKeyOf(ym: string): MonthKey | null {
  const p = parts(ym);
  return p ? MONTH_KEYS[p.month] : null;
}

/**
 * Le libellé TRADUIT d'un mois (« Octobre », « January »), ou une chaîne vide
 * si le mois est illisible : jamais de trou de langue deviné en base.
 */
export function paymentMonthLabel(ym: string, t: TranslationDict): string {
  const key = monthKeyOf(ym);
  return key ? t[key] : '';
}

/**
 * La forme d'un choix, CALCULÉE et non devinée :
 *  • `none`   — rien de coché ;
 *  • `single` — un mois ;
 *  • `range`  — plusieurs mois qui se suivent (du premier au dernier) ;
 *  • `list`   — plusieurs mois troués, dans l'ordre.
 */
export type PaidMonthsShape =
  | { kind: 'none' }
  | { kind: 'single'; from: string; to: string }
  | { kind: 'range'; count: number; from: string; to: string }
  | { kind: 'list'; count: number; months: string[] };

export function paidMonthsShape(months: readonly string[]): PaidMonthsShape {
  const clean = sortPaymentMonths(months);
  if (clean.length === 0) return { kind: 'none' };
  if (clean.length === 1) return { kind: 'single', from: clean[0], to: clean[0] };
  const ranks = clean.map((ym) => rank(ym) as number);
  const consecutive = ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
  return consecutive
    ? { kind: 'range', count: clean.length, from: clean[0], to: clean[clean.length - 1] }
    : { kind: 'list', count: clean.length, months: clean };
}

/**
 * Les mots du reçu, fournis par l'appelant : le module ne va pas chercher la
 * langue lui-même, donc le même choix s'écrit « 3 mois : Septembre à Novembre »
 * ou « 3 months : September to November » selon le reçu.
 */
export interface PaidMonthsWords {
  label: (ym: string) => string;
  count: (n: number) => string;
  rangeTo: string;
}

/**
 * Le choix RÉEL : celui du caissier dès qu'il a coché, sinon le mois de la DATE.
 *
 * C'est la règle qui empêche le reçu de se contredire : changer la date d'octobre
 * à novembre AVANT d'avoir touché aux pastilles doit mettre Novembre sur la ligne
 * « Mois », sinon le reçu porte « Octobre » en face d'une date de novembre.
 *
 * Le mois de la date n'est retenu que s'il est PROPOSÉ : sur une date hors de
 * l'année scolaire offerte, on ne coche pas un mois qui n'existe pas sur l'écran.
 */
export function effectivePaymentMonths(
  selected: readonly string[],
  touched: boolean,
  dateMonth: string,
  options: readonly string[],
): string[] {
  if (touched) return sortPaymentMonths(selected);
  return options.includes(dateMonth) ? [dateMonth] : sortPaymentMonths(selected);
}

/**
 * Cocher/décocher un mois, sur la base du choix réel. Le résultat est toujours
 * trié dans l'ordre du calendrier scolaire : l'ordre des clics n'a pas à se voir
 * sur un reçu.
 */
export function toggledPaymentMonths(
  selected: readonly string[],
  touched: boolean,
  dateMonth: string,
  options: readonly string[],
  month: string,
): string[] {
  const base = effectivePaymentMonths(selected, touched, dateMonth, options);
  return sortPaymentMonths(base.includes(month) ? base.filter((m) => m !== month) : [...base, month]);
}

/**
 * Le texte de la ligne « Mois ». Un seul mois se dit NU — « Octobre » — sans le
 * « 1 mois » qui n'apprendrait rien et mangerait la place de la ligne.
 */
export function formatPaidMonths(months: readonly string[], words: PaidMonthsWords): string {
  const shape = paidMonthsShape(months);
  if (shape.kind === 'none') return '';
  if (shape.kind === 'single') return words.label(shape.from);
  if (shape.kind === 'range') {
    return `${words.count(shape.count)} : ${words.label(shape.from)} ${words.rangeTo} ${words.label(shape.to)}`;
  }
  return `${words.count(shape.count)} : ${shape.months.map(words.label).join(', ')}`;
}

/**
 * Vrai pour un reçu MUET : il ne déclare AUCUN mois.
 *
 * C'est LE critère, écrit une seule fois. `monthsCoverage().undeclared` compte
 * exactement ces reçus, et l'écran École des reçus muets (`src/lib/silentReceipts.ts`)
 * les LISTE avec cette même fonction : deux définitions de « muet » finiraient
 * par diverger, et l'école verrait alors un compte qui ne nomme pas les mêmes
 * reçus que sa liste.
 *
 * Absent ou vide, c'est la même chose — un reçu d'avant la colonne `payments.months`
 * a pris `{}`, et un reçu envoyé sans cocher arrive vide. Sa couverture est
 * INCONNUE, elle n'est pas nulle : d'où le mot « muet » plutôt que « vide ».
 */
export function isSilentReceipt(months: readonly string[] | undefined): boolean {
  return !months || months.length === 0;
}

/**
 * Ce qu'une fiche élève peut AFFIRMER de ses mois, et ce qu'elle ne peut pas.
 *
 *   • `covered` — les mois de l'année que des paiements déclarent couvrir,
 *     dans l'ordre du calendrier scolaire (l'union de tous les paiements : un
 *     mois réglé deux fois reste réglé, et c'est `sortPaymentMonths` qui range
 *     et dédoublonne) ;
 *   • `missing` — le reste de l'année, dans le même ordre ;
 *   • `undeclared` — combien de paiements ne déclarent AUCUN mois.
 *
 * Ce dernier compte est la raison d'être de cette brique. Un paiement saisi
 * avant la colonne `payments.months`, ou envoyé sans cocher, ne dit pas ce qu'il
 * couvre : sa couverture est INCONNUE. L'aligner sur « rien » ferait afficher
 * « à régler » en face d'un mois déjà payé — un papier d'école qui accuse une
 * famille qui a payé. La fiche lit donc ce compte et le DIT (voir
 * `StudentDetailsModal`) : un mois non déclaré n'est pas un mois non payé.
 *
 * Le mois de l'année est un `YYYY-MM` : il porte son année civile, donc un
 * recoupement avec les douze mois de l'année scolaire ne peut pas confondre
 * septembre 2026 et septembre 2027. Une année illisible rend `[]` (cf.
 * `academicYearMonths`) : pas d'année, pas de bande — jamais de mois inventé.
 */
export interface MonthsCoverage {
  covered: string[];
  missing: string[];
  undeclared: number;
}

export function monthsCoverage(
  payments: readonly (readonly string[] | undefined)[],
  yearMonths: readonly string[],
): MonthsCoverage {
  const declared = payments.flatMap((months) => months ?? []);
  const covered = sortPaymentMonths(declared).filter((ym) => yearMonths.includes(ym));
  const missing = yearMonths.filter((ym) => !covered.includes(ym));
  const undeclared = payments.filter((months) => isSilentReceipt(months)).length;
  return { covered, missing, undeclared };
}

/**
 * Les mois d'un choix qui ne sont PAS déjà couverts par un reçu — ceux que le
 * guichet peut encore proposer.
 *
 * Un mois qu'un reçu de l'élève déclare couvrir ne peut pas être vendu une
 * seconde fois : la grille des pastilles l'écarte. La brique est PURE et sans
 * état, donc l'écran et le domaine écartent la MÊME liste — deux retraits écrits
 * séparément finiraient par diverger, et un guichet laisserait repasser le mois
 * que l'autre refuse.
 *
 * `paidMonths` vient de `monthsCoverage().covered`, donc déjà restreint à
 * l'année proposée et déjà trié : un mois d'une autre année scolaire ne peut pas
 * retirer un mois de celle-ci (voir `monthsCoverage`).
 */
export function monthsNotYetPaid(months: readonly string[], paidMonths: readonly string[]): string[] {
  return sortPaymentMonths(months).filter((ym) => !paidMonths.includes(ym));
}

/**
 * ─── LE REÇU QUI COUVRE UN MOIS ─────────────────────────────────────────────
 *
 * « Ce mois est déjà payé » suffit à refuser un second encaissement, mais pas à
 * lever le doute du caissier : devant une famille qui présente un papier, il lui
 * faut savoir QUEL reçu couvre le mois — sa date, son montant, son numéro. Sans
 * cela le refus est un mur muet, et le caissier ne peut ni vérifier ni expliquer.
 *
 * `paymentMonthHistory` attache donc à chaque mois couvert les reçus qui le
 * déclarent, lus sur les MÊMES paiements que `monthsCoverage` : une seule
 * définition de « couvert », et la preuve avec. Le plus ANCIEN sert de référence
 * à la phrase (c'est celui que la famille a vraisemblablement en main ; à date
 * égale, l'ordre de la liste — celle de l'élève, donc stable — tranche).
 *
 * Quand PLUSIEURS reçus déclarent le même mois, la liste les porte TOUS : c'est
 * très exactement le doublon enregistré avant cette règle, et l'école ne peut le
 * nettoyer que si l'écran les nomme — n'en montrer qu'un laisserait le second
 * invisible, donc intact.
 *
 * Un reçu MUET ne produit aucun fait — sa couverture est inconnue — mais il reste
 * COMPTÉ (`undeclared`), comme dans `monthsCoverage`.
 */

/**
 * La forme MINIMALE d'un paiement dont ce module a besoin : les mois qu'il
 * déclare, sa date, son montant et son numéro. Les deux `Payment` du dépôt
 * (App et couche de données) s'y conforment sans conversion.
 */
export interface PaymentLike {
  /** L'id de la ligne `payments` — sans lui, aucun reçu ne peut être retiré. */
  id?: string;
  months?: readonly string[] | undefined;
  date: string;
  amount: number;
  receiptNumber?: string;
}

/** Un reçu qui déclare un mois — de quoi l'identifier, le montrer, le retirer. */
export interface PaymentMonthReceipt {
  /** L'id de la ligne `payments` : c'est lui qui permet de retirer CE reçu. */
  id?: string;
  /** La date du reçu (`YYYY-MM-DD`, telle qu'elle est stockée). */
  date: string;
  /** Son montant. */
  amount: number;
  /** Son numéro, ABSENT sur une ligne écrite avant la colonne. */
  receiptNumber?: string;
}

/**
 * Ce qu'un mois de l'année porte comme preuve : TOUS les reçus qui le déclarent.
 *
 * La liste entière, et pas seulement le plus ancien : un mois déclaré deux fois
 * est un doublon DÉJÀ ENREGISTRÉ, et l'école ne peut le nettoyer que si l'écran
 * nomme les deux reçus — n'en montrer qu'un laisserait le second invisible, donc
 * intact.
 */
export interface PaymentMonthFact {
  /** Le mois `YYYY-MM` déjà couvert. */
  month: string;
  /** Les reçus qui le déclarent, du plus ANCIEN au plus récent (jamais vide). */
  receipts: PaymentMonthReceipt[];
}

export interface PaymentMonthHistory {
  /** Les mois couverts, dans l'ordre du calendrier, chacun avec son reçu. */
  facts: PaymentMonthFact[];
  /** Combien de paiements ne déclarent AUCUN mois (couverture inconnue). */
  undeclared: number;
}

export function paymentMonthHistory(
  payments: readonly PaymentLike[],
  yearMonths: readonly string[],
): PaymentMonthHistory {
  // « Couvert » se lit ICI, et nulle part ailleurs : la liste des mois reste celle
  // de `monthsCoverage`, à laquelle on accroche seulement la preuve.
  const { covered, undeclared } = monthsCoverage(payments.map((p) => p.months), yearMonths);
  const facts = covered.map((month) => ({
    month,
    receipts: payments
      .filter((p) => (p.months ?? []).includes(month))
      .map((p) => ({ id: p.id, date: p.date, amount: p.amount, receiptNumber: p.receiptNumber }))
      // Du plus ancien au plus récent : l'ordre d'un carnet de caisse, et donc
      // l'ordre dans lequel la famille a présenté ses papiers. À date égale,
      // `sort` étant stable, l'ordre de la liste de l'élève tranche.
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)),
  }));
  return { facts, undeclared };
}

/**
 * ─── LE REÇU EN TROP ────────────────────────────────────────────────────────
 *
 * Un mois déclaré par PLUSIEURS reçus est un doublon DÉJÀ ENREGISTRÉ — deux
 * saisies du même encaissement, ou deux dépôts réellement reçus. L'application
 * ne peut pas savoir lequel est en trop, mais elle peut dire lesquels se
 * disputent le mois, et à quelle ligne chacun correspond.
 *
 * C'est ce que rend cette brique, rangée par reçu : pour chaque reçu qui déclare
 * un mois DÉJÀ déclaré par un reçu plus ancien, le mois en cause et les reçus
 * antérieurs qui le portent. L'écran de la fiche élève s'en sert pour marquer la
 * ligne fautive — sans cela, le doublon resterait invisible, donc intact, et
 * aucun caissier ne saurait quel reçu propose d'annuler (`deletePayment`).
 *
 * Le PREMIER reçu d'un mois n'est jamais un doublon : c'est lui la référence.
 * Un reçu sans id (ligne écrite avant la colonne, import) ne produit rien : il
 * ne peut pas être retiré, donc le désigner serait un geste sans suite.
 */
export interface DuplicateDeclaration {
  /** L'id du reçu EN TROP — celui par qui ce mois est déclaré une fois de trop. */
  receiptId: string;
  /** Le mois `YYYY-MM` déclaré deux fois. */
  month: string;
  /** Les reçus ANTÉRIEURS qui déclarent déjà ce mois (jamais vide). */
  earlier: PaymentMonthReceipt[];
}

export function duplicateDeclarations(
  payments: readonly PaymentLike[],
  yearMonths: readonly string[],
): DuplicateDeclaration[] {
  const out: DuplicateDeclaration[] = [];
  for (const { month, receipts } of paymentMonthHistory(payments, yearMonths).facts) {
    receipts.forEach((receipt, index) => {
      // Le premier n'est en trop pour personne : c'est la référence du mois.
      if (index === 0 || !receipt.id) return;
      out.push({ receiptId: receipt.id, month, earlier: receipts.slice(0, index) });
    });
  }
  return out;
}

/**
 * Les mots dont la preuve d'un mois a besoin — fournis par l'appelant, comme
 * pour `formatPaidMonths` : le module ne va pas chercher la langue ni la monnaie
 * lui-même, donc la même preuve s'écrit « reçu REC-123 du 05/10/2026, 25 000 FCFA »
 * ou « receipt REC-123 of 10/05/2026, 25,000 FCFA » selon l'écran.
 */
/**
 * La PREUVE d'UN reçu : « reçu REC-123 du 05/10/2026, 25 000 FCFA » — ou, sur
 * une ligne écrite avant la colonne, « paiement du 05/10/2026, 25 000 FCFA ».
 *
 * C'est le seul endroit qui choisit entre « reçu numéroté » et « paiement sans
 * numéro » : deux copies de ce choix finiraient par diverger, et l'écran
 * montrerait alors une preuve que le message de refus ne dit pas. C'est aussi la
 * phrase de chaque ligne de la liste d'un mois déclaré deux fois.
 */
export function paidReceiptEvidence(receipt: PaymentMonthReceipt, t: TranslationDict, lang: Language): string {
  const date = formatDateLang(receipt.date, lang);
  const amount = formatCurrency(receipt.amount);
  return receipt.receiptNumber
    ? t.paidMonthEvidence.replace('{receipt}', receipt.receiptNumber).replace('{date}', date).replace('{amount}', amount)
    : t.paidMonthEvidenceNoReceipt.replace('{date}', date).replace('{amount}', amount);
}

/**
 * La LIGNE d'un mois déjà réglé. C'est la phrase que la fenêtre de saisie écrit
 * sous la grille, et elle vient d'ici pour que l'écran et le refus d'envoi
 * racontent le même fait de la même façon.
 *
 *   • UN seul reçu déclare le mois → « Octobre — déjà payé : reçu REC-123 du … » ;
 *   • PLUSIEURS → « Octobre — déjà payé : 2 reçus déclarent ce mois », et l'écran
 *     liste ensuite les reçus un par un (`paidReceiptEvidence`) avec, sur chacun,
 *     de quoi retirer celui qui est en trop. Citer le premier et taire le second
 *     laisserait le doublon intact, puisque invisible.
 */
export function formatPaidMonthLine(fact: PaymentMonthFact, t: TranslationDict, lang: Language): string {
  const [first, ...rest] = fact.receipts;
  const evidence = !first
    ? ''
    : rest.length > 0
      ? t.paidMonthSharedBy.replace('{count}', String(fact.receipts.length))
      : paidReceiptEvidence(first, t, lang);
  return t.paidMonthAlreadyPaid
    .replace('{month}', paymentMonthLabel(fact.month, t))
    .replace('{evidence}', evidence);
}

/**
 * La forme COURTE du même fait — « Octobre (reçu REC-123 du …) » — pour une
 * phrase qui porte déjà son propre verbe (le message de refus : « Déjà réglés
 * pour cet élève : Octobre (…). »). Un mois déclaré deux fois le dit aussi, en
 * clair : le refus ne peut pas, lui, dérouler une liste.
 */
export function formatPaidMonthTerse(fact: PaymentMonthFact, t: TranslationDict, lang: Language): string {
  const label = paymentMonthLabel(fact.month, t);
  const [first, ...rest] = fact.receipts;
  if (!first) return label;
  const doubled = rest.length > 0
    ? ` — ${t.paidMonthSharedBy.replace('{count}', String(fact.receipts.length))}`
    : '';
  return `${label} (${paidReceiptEvidence(first, t, lang)}${doubled})`;
}
