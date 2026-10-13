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
import type { TranslationDict } from '../i18n/translations';

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
  const undeclared = payments.filter((months) => !months || months.length === 0).length;
  return { covered, missing, undeclared };
}
