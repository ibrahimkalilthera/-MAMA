/**
 * ─── LE NUMÉRO D'UN REÇU ────────────────────────────────────────────────────
 *
 * Le numéro était tiré de l'HORLOGE : `REC-` suivi des six derniers chiffres du
 * temps courant. Six chiffres, c'est un million de valeurs, et l'horloge les
 * parcourt en 16 minutes 40 secondes : deux reçus émis à 17 h 20 et à 17 h 37
 * pouvaient porter le MÊME numéro. Sur un papier qu'une famille présente pour
 * prouver un paiement, deux reçus qui se confondent ne sont pas un détail
 * d'affichage — c'est la preuve elle-même qui devient ambiguë, et rien dans la
 * base ne peut les distinguer puisqu'ils sont réellement différents.
 *
 * Le numéro se dérive donc de l'IDENTIFIANT DU GESTE, et non plus du temps :
 *
 *   • l'id de la ligne `payments` est une clé primaire — deux reçus ne peuvent
 *     pas la partager, donc deux reçus ne peuvent pas partager leur numéro ;
 *   • il est minté par l'écran AVANT l'envoi (`useGestureId`), donc le même
 *     numéro part en base, s'imprime sur le PDF et survit à une coupure réseau :
 *     un reçu saisi hors ligne n'attend pas la base pour avoir son numéro ;
 *   • il ne dépend d'aucun état de poste (compteur, `localStorage`) : une
 *     réinstallation, une autre station, un rejeu — le même geste redonne le
 *     même numéro, et un doublon d'envoi ne fabrique pas un second numéro.
 *
 * La forme reste lisible pour l'œil et dictable au téléphone : `REC-26-1A2B3C4D`
 * — préfixe, millésime de l'exercice, puis huit caractères hexadécimaux. Les
 * reçus ANTÉRIEURS gardent leur forme (`REC-` + six chiffres) : un papier déjà
 * remis à une famille ne change pas de numéro parce que le code a changé.
 *
 * Le module est PUR : ni horloge, ni réseau, ni React. Une date ne sert qu'à
 * LIRE le millésime quand l'exercice n'est pas fourni — jamais à fabriquer de
 * l'aléa.
 */

/** Le préfixe de tous les reçus, anciens et nouveaux. */
export const RECEIPT_NUMBER_PREFIX = 'REC-';

/** `REC-26-1A2B3C4D` — la forme courante. */
const CURRENT_FORMAT = /^REC-\d{2}-[0-9A-F]{8}$/;

/** `REC-123456` — la forme d'avant, conservée telle quelle. */
const LEGACY_FORMAT = /^REC-\d{6}$/;

/**
 * L'entrée ne dit pas de quel exercice relève le reçu.
 *
 * Ce n'est pas une panne technique mais une information manquante : inventer le
 * millésime produirait un numéro faux sur un papier officiel. L'appelant sait
 * toujours l'année (la fiche de l'élève, ou l'exercice sélectionné) ; s'il ne la
 * fournit pas, on refuse au lieu de deviner.
 */
export class ReceiptYearUnreadableError extends Error {
  constructor() {
    super('Numéro de reçu impossible : ni l’exercice ni la date ne disent le millésime.');
    this.name = 'ReceiptYearUnreadableError';
  }
}

export interface ReceiptNumberInput {
  /** L'id de la ligne `payments` — la clé qui rend deux numéros impossibles à confondre. */
  paymentId: string;
  /** L'exercice scolaire (`2026-2027`) : il donne le millésime du reçu. */
  academicYear?: string | null;
  /** La date du reçu (`2026-10-07`), lue seulement si l'exercice manque. */
  date?: string | null;
}

/**
 * Le millésime sur deux chiffres : `2026-2027` → `26`, `2026` → `26`.
 *
 * On lit la chaîne, jamais un objet `Date` : une conversion de fuseau ne peut
 * donc pas faire basculer un reçu du 31 décembre sur l'exercice suivant.
 */
function yearTagOf(input: ReceiptNumberInput): string {
  const year = /^(\d{4})(?:-\d{4})?$/.exec(String(input.academicYear ?? '').trim());
  if (year) return year[1].slice(2);
  const fromDate = /^(\d{4})-\d{2}-\d{2}$/.exec(String(input.date ?? '').trim());
  if (fromDate) return fromDate[1].slice(2);
  throw new ReceiptYearUnreadableError();
}

/** Les trente-deux caractères hexadécimaux d'un UUID, sans tirets. */
function hexOf(value: string): string | null {
  const compact = value.replace(/-/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(compact) ? compact : null;
}

/**
 * Un hachage stable pour un id qui n'est pas un UUID.
 *
 * Le seul cas légitime est le repli de `createRowId` quand WebCrypto manque
 * (`off_…`) : l'id reste unique, mais il n'est pas hexadécimal. On le hache donc
 * avec deux fonctions complémentaires (FNV-1a et djb2) pour que dix mille ids
 * différents ne se rangent pas dans quelques seaux — le test le vérifie.
 */
function stableHash8(value: string): string {
  let fnv = 0x811c9dc5;
  let djb = 0x1505;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    fnv ^= code;
    // Multiplication 32 bits explicite : `* 16777619` déborderait la précision
    // flottante de JavaScript et rendrait le hachage dépendant de la machine.
    fnv = Math.imul(fnv, 0x01000193) >>> 0;
    djb = (Math.imul(djb, 33) + code) >>> 0;
  }
  return `${fnv.toString(16).padStart(8, '0')}${djb.toString(16).padStart(8, '0')}`
    .slice(0, 8)
    .toUpperCase();
}

/**
 * Le numéro du reçu — déterministe, unique par geste, sans horloge.
 *
 * Le même `paymentId` rend TOUJOURS le même numéro : la réimpression d'un reçu,
 * le rejeu d'un geste hors ligne et un double envoi ne peuvent pas fabriquer
 * deux numéros pour un seul paiement.
 */
export function receiptNumberFor(input: ReceiptNumberInput): string {
  const yearTag = yearTagOf(input);
  const id = String(input.paymentId ?? '');
  const hex = hexOf(id);
  // Les HUIT DERNIERS caractères, pas les premiers : un UUID ordonné par le
  // temps (v7) porte l'horodatage en tête, donc ses huit premiers caractères se
  // ressembleraient d'un reçu à l'autre. La queue est la partie aléatoire des
  // UUID modernes, et elle reste stable pour un même geste.
  const body = hex ? hex.slice(-8).toUpperCase() : stableHash8(id);
  return `${RECEIPT_NUMBER_PREFIX}${yearTag}-${body}`;
}

/** Ce numéro a-t-il la forme COURANTE (`REC-26-1A2B3C4D`) ? */
export function receiptNumberIsCurrentFormat(value: string): boolean {
  return CURRENT_FORMAT.test(value);
}

/**
 * Ce numéro vient-il de l'ancienne génération (`REC-123456`) ?
 *
 * Sert à une seule décision : NE PAS le réécrire. Un reçu déjà remis à une
 * famille porte ce numéro sur son papier ; le renuméroter dans la base ferait
 * diverger le registre du document détenu par l'école.
 */
export function legacyReceiptNumberIsKept(value: string | undefined): boolean {
  return typeof value === 'string' && LEGACY_FORMAT.test(value);
}
