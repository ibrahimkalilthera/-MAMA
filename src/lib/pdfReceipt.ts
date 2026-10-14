/**
 * Reçu de paiement des parents — the official paper form.
 *
 * Same discipline as the fiche/bulletin/technique generators: the document
 * downloaded IS the school's own paper receipt — `public/templates/recu-parent.pdf`
 * (the exact PDF provided by the Direction: raster form with the emblem, the
 * blue double border, the BPF box with its gradient pill, the M / La somme de /
 * Mois & Classe / Motif fill-in lines and the Date, le … 20 …  N° footer) —
 * and only the payment data is printed on it:
 *
 *   • « M » gets the selected student's full name, never the parent's name,
 *     followed by the student's MATRICULE (« MATRICULE : MT-2026-001 ») so a
 *     family can quote it from the receipt — the form has no matricule line of
 *     its own, and the pupil identity line is where it belongs. The two SHARE
 *     the line: the name shrinks (never truncates) to leave the matricule room;
 *   • « Tél. : » (header) gets the SCHOOL's own contact number — a fixed
 *     number, the same on every receipt, written on the dotted line right
 *     after the printed label. Until 2026-10-05 this line carried the PARENT's
 *     phone; the Direction asked for the school number instead (a receipt is
 *     an act of the school, and the payer's number is already on the pupil's
 *     file). See `SCHOOL_PHONE` below;
 *   • « La somme de : » gets the paid amount IN WORDS (French, capitalized);
 *   • the BPF gradient pill (sous BPF) gets the paid amount IN FIGURES,
 *     « … FCFA »;
 *   • « Mois » gets the months the payment COVERS when the cashier chose them
 *     (see src/lib/paymentMonths.ts): « Octobre » for one, « 3 mois : Septembre
 *     à Novembre » when they run, « 3 mois : Septembre, Novembre, Décembre »
 *     when they do not. The line is SHRUNK to fit the printed dotted line, and
 *     when even the smallest size overflows (a payment covering seven months
 *     with gaps) it falls back to the COUNT alone — a month name is never cut
 *     in half. A payment with no months chosen keeps the month of its date, so
 *     a receipt reprinted from an older row is unchanged;
 *   • « Classe » gets the student grade — written centered on the right end
 *     of the dotted line, where the Direction marks the class entry (no
 *     drawn box: the Direction asked for the spot and size only);
 *   • « Motif » gets the payment reason — « Frais de scolarité » for the
 *     ordinary payment, « Inscription » when the cashier chose the entry fee
 *     (see src/lib/paymentMotifs.ts: the stored key is `scolarite` /
 *     `inscription`, never a label). The line is shrunk to fit the dotted line
 *     like the « Mois » one, and a payment whose row declares no motif — every
 *     row written before the column, and every import — keeps the ordinary
 *     word, so a receipt reprinted from an older row is unchanged;
 *   • « Date, le … 20 … » gets the payment date: dd/mm/ centered on the
 *     dotted line just before the pre-printed « 20 » (same spot, no drawn
 *     box), then the last two year digits written after the « 20 »;
 *   • the « N° » box gets the receipt number.
 *
 * The matricule LABEL is the only label this generator draws (`t.studentId`):
 * every other label is printed on the paper template itself, and the form has no
 * matricule line to lean on. `lang` localizes the month name, the payment motif
 * and that label.
 */
import type { Student, Payment } from './useSupabaseData';
import { showReceiptPreview } from './receiptPreview';
import { downloadBytes } from './browserDownload';
import { montantEnLettres } from './pdfPayrollBulletin';
import { studentMatricule } from './studentIdentifiers';
import { formatPaidMonths, paidMonthsShape, paymentMonthLabel, MONTH_KEYS } from './paymentMonths';
import { paymentMotifLabel, paymentMotifOf } from './paymentMotifs';
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';

export interface ReceiptDataOptions {
  student: Student;
  payment: Payment;
  lang?: 'en' | 'fr';
  cashierName?: string;
  /**
   * Override for the official paper template bytes (tests inject the file
   * directly). Defaults to fetching `/templates/recu-parent.pdf`.
   */
  template?: Uint8Array | ArrayBuffer;
}

export interface GeneratedReceipt {
  bytes: Uint8Array;
  filename: string;
}

/** Template asset served from the app's public directory. */
const TEMPLATE_URL = 'templates/recu-parent.pdf';

/**
 * « Tél. : » (header) — the school's own contact number, the same on EVERY
 * receipt. Asked for by the Direction le 2026-10-05 (the line used to carry the
 * parent's phone). Both numbers are dialable as written; the separator is the
 * one printed on the school's other documents.
 */
export const SCHOOL_PHONE = '77549752/70382542';

// ─── Template geometry (mm from the top-left of the rendered page) ───────────
// Calibrated against the paper receipt raster (12 px/mm render of the
// 201.1 × 155.8 mm page). Landmarks were located by pixel scans:
//
//   • « M » line:  label x 10.5–16.4, dotted line x 18.3–190.8, y 79.5–84.6
//     (center 82.0);
//   • « La somme de : »: label x 10.7–52.2, dotted lines y 90.3–95.6
//     (center 92.9) and y 104.6–107.0 (center 105.8);
//   • « Mois : » label x 10.7–28.4, dots x 30.8–99.2 ; « Classe : » label
//     x 129.2–148.1, dots x 152.3–182 — shared baseline y 111.8–117.1
//     (center 114.4);
//   • « Motif : » label x 10.7–30.5, dots x 34–190, y 123.0–128.4
//     (center 125.7);
//   • « Date, le » label x 59.4–73.3, dotted line to the pre-printed « 20 »
//     (x 118.8–125.4), y 137.4–142.2 (center 139.8);
//   • the « N° » box (rounded outline): x 154.3–191.9, y 132.5–144.3
//     (center 173.1, 138.4);
//   • the CLASS entry sits at the spot the Direction marked on the filled
//     receipt (center x 180.95 — the red square was x 175.2–186.7, y
//     110.1–123.2 on the right end of the « Classe : » dotted line), ON
//     the printed line itself (y 114.4, same baseline as « Mois »). Only
//     the position and size were requested: no box is drawn;
//   • the DATE entry (dd/mm/) sits centered on the « Date, le » dotted line
//     just before the pre-printed « 20 »: the Direction's red square was
//     x 107.2–115.5 (widened to x 102.2–117.8 to fit « dd/mm/ » at the
//     larger size) — anchor (110.0, 139.8), on the same baseline as the
//     year digits;
//   • the « Tél. : » header line: the label glyphs sit at x 75–92 (band
//     y 45.0–48.0, center 46.5), then the dotted line runs x 93–174.5 at
//     y 47.5–48.5 (baseline level 48.0) — the school's number starts right
//     after the label (x 93.0), on the line;
//   • the BPF box: dark blue label block x 158–192, y 20–33 (white « BPF »
//     text at y 24–32), then the gradient pill x 158–190.5, y 36–45.5 — dark
//     blue at the ends, LIGHT in the middle (x 162.7–184.9) where the paid
//     amount in figures is written, centered on (174.3, 40.8).
export const LINE_M = { x: 20.5, y: 82.0 };
/** « Tél. : » entry anchor — right after the printed label, on its dotted line (baseline 48.0). */
export const TEL = { x: 93.0, y: 46.3 };
export const SOMME_LINE1 = { x: 54.5, y: 92.9 };
export const SOMME_LINE2 = { x: 13.5, y: 105.8 };
export const MOIS = { x: 31.5, y: 114.4 };
export const MOTIF = { x: 33.0, y: 125.7 };
/** « Classe » entry anchor — on the printed line (y 114.4), at the Direction's marked spot (x 180.95). */
export const CLASSE = { x: 180.95, y: 114.4 };
/** « Date » entry anchor — dd/mm/ centered before the pre-printed « 20 ». */
export const DATE = { x: 110.0, y: 139.8 };
/** The pre-printed « 20 » of the year on the date line (x 118.8–125.4). */
export const DATE_PRINTED_20_X1 = 125.4;
export const PILL = { x0: 158.0, x1: 190.5, y0: 36.0, y1: 45.5 };
export const NBOX = { x0: 154.3, x1: 191.9, y0: 132.5, y1: 144.3 };
/** Light (readable) middle of the pill — the text must stay inside it. */
const PILL_TEXT_MAX_W = 22.2;

const PT_PER_MM = 72 / 25.4;

/** Inks that read like typed entries on the paper form. */
const INK = { r: 0.09, g: 0.12, b: 0.2 }; // near-black slate
const DARK_BLUE = { r: 0.04, g: 0.13, b: 0.42 }; // deep blue #0A226B
/** Shared size for the handwritten-style entries (the letters were too small). */
const DATA_SIZE = 14;
/** Max width of the class entry — the width of the spot the Direction marked. */
const CLASSE_MAX_W = 11.5;

interface PtFont {
  font: import('pdf-lib').PDFFont;
  size: number;
}

async function loadTemplateBytes(template?: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (template) return template instanceof Uint8Array ? template : new Uint8Array(template);
  const baseUrl =
    typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL
      ? (import.meta as { env: { BASE_URL: string } }).env.BASE_URL
      : '/';
  const res = await fetch(`${baseUrl}${TEMPLATE_URL}`);
  if (!res.ok) throw new Error(`Le modèle du reçu des parents est introuvable (HTTP ${res.status}).`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Formats an amount like the school writes it: thin spaces + the FCFA unit. */
function fmtFcfa(value: number): string {
  return `${value.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;
}

/** Capitalizes the first letter of the French amount in words. */
function amountInWords(value: number): string {
  const words = montantEnLettres(value);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)} francs CFA`;
}

/** Formats an ISO date as dd/mm/yyyy (French style). */
function fmtDateShort(iso: string | undefined): { ddmm: string; yy: string } {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return { ddmm: '', yy: '' };
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  return { ddmm: `${dd}/${mm}/`, yy: yyyy.slice(-2) };
}

/**
 * Builds the parent payment receipt: the school's own paper form with the
 * payment data stamped on it. Returns the generated bytes (tests inject the
 * template file and assert on the result); the browser download is triggered
 * by {@link generatePaymentReceiptPdf}.
 */
export async function buildParentReceiptPdf({
  student,
  payment,
  lang = 'fr',
  template,
}: ReceiptDataOptions): Promise<GeneratedReceipt> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const receiptNo = payment.receiptNumber || `REC-${Date.now().toString().slice(-6)}`;
  const amount = payment.amount || 0;

  const templateBytes = await loadTemplateBytes(template);
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPage(0);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Visible page box: the template MediaBox origin is x = 13.06 pt = 4.607 mm,
  // so coordinates measured on the rendered page map back with the +media.x
  // shift (unlike the bulletin whose constants are in the unshifted space).
  const media = page.getMediaBox();
  const topPt = media.y + media.height;

  const mmToPdfX = (mm: number) => media.x + mm * PT_PER_MM;
  const mmToPdfY = (mm: number) => topPt - mm * PT_PER_MM;
  const text = (
    str: string,
    xMm: number,
    yMm: number,
    { font, color = INK }: { font: PtFont; color?: { r: number; g: number; b: number } },
  ): void => {
    page.drawText(str, { x: mmToPdfX(xMm), y: mmToPdfY(yMm), size: font.size, font: font.font, color: rgb(color.r, color.g, color.b) });
  };

  const baseline = (centerY: number, sizePt: number) => centerY + (sizePt / PT_PER_MM) * 0.35;

  /** Centered text helper (for the marked class/date spots). */
  const textCentered = (str: string, cx: number, cy: number, font: PtFont): void => {
    const wMm = font.font.widthOfTextAtSize(str, font.size) / PT_PER_MM;
    text(str, cx - wMm / 2, baseline(cy, font.size), { font });
  };

  // 1. « M » — identify the selected student, even when a parent pays.
  // Keep the full name and shrink it to fit the dotted line rather than truncate.
  // Le MATRICULE suit le nom sur la MÊME ligne : le formulaire papier n'a pas de
  // champ matricule, et c'est la ligne d'identité de l'élève — ce que la famille
  // retrouve sur ses autres papiers (fiche, relevé de compte). Le nom rétrécit
  // pour lui laisser sa place, sans jamais être tronqué.
  const studentName = student.name.trim() || '—';
  const matricule = studentMatricule(student.studentId);
  const matriculeText = matricule ? `${t.studentId} : ${matricule}` : '';
  const matriculeSize = DATA_SIZE - 2;
  const matriculeGapMm = 4;
  const matriculeW = matriculeText
    ? helv.widthOfTextAtSize(matriculeText, matriculeSize) / PT_PER_MM
    : 0;
  const nameMaxW = (191 - LINE_M.x) - (matriculeW ? matriculeW + matriculeGapMm : 0);
  const nameWidth = helv.widthOfTextAtSize(studentName, DATA_SIZE) / PT_PER_MM;
  const nameSize = Math.min(DATA_SIZE, (nameMaxW / nameWidth) * DATA_SIZE);
  text(studentName, LINE_M.x, baseline(LINE_M.y, nameSize), { font: { font: helv, size: nameSize } });
  if (matriculeText) {
    const drawnNameW = helv.widthOfTextAtSize(studentName, nameSize) / PT_PER_MM;
    text(matriculeText, LINE_M.x + drawnNameW + matriculeGapMm, baseline(LINE_M.y, matriculeSize), { font: { font: helv, size: matriculeSize } });
  }

  // 1b. « Tél. : » — the SCHOOL's own number (fixed, never the parent's), on
  //     the header dotted line right after the printed label (fits the line at
  //     most, like the class). Always written: it belongs to the school.
  const phone = SCHOOL_PHONE;
  const telMaxW = 174.5 - TEL.x;
  const phoneW = helv.widthOfTextAtSize(phone, DATA_SIZE) / PT_PER_MM;
  const phoneSize = Math.min(DATA_SIZE, (telMaxW / phoneW) * DATA_SIZE);
  text(phone, TEL.x, baseline(TEL.y, phoneSize), { font: { font: helv, size: phoneSize } });

  // 2. « La somme de : » — the amount in words, wrapped on the two dotted lines.
  const words = amountInWords(amount);
  const wordFont: PtFont = { font: helv, size: DATA_SIZE };
  const line1MaxW = 190 - SOMME_LINE1.x;
  const line2MaxW = 190 - SOMME_LINE2.x;
  const wordsW = (s: string) => helv.widthOfTextAtSize(s, DATA_SIZE) / PT_PER_MM;
  if (wordsW(words) <= line1MaxW) {
    text(words, SOMME_LINE1.x, baseline(SOMME_LINE1.y, DATA_SIZE), { font: wordFont });
  } else {
    const wordsArr = words.split(' ');
    let line1 = '';
    let line2 = '';
    for (const w of wordsArr) {
      const candidate = line1 ? `${line1} ${w}` : w;
      if (!line1 || wordsW(candidate) <= line1MaxW) line1 = candidate;
      else line2 = line2 ? `${line2} ${w}` : w;
    }
    if (!line2) {
      text(words, SOMME_LINE1.x, baseline(SOMME_LINE1.y, DATA_SIZE - 3.5), { font: { font: helv, size: DATA_SIZE - 3.5 } });
    } else {
      if (wordsW(line2) > line2MaxW) line2 = `${line2.slice(0, Math.max(20, Math.floor(line2MaxW / 2.2)))}…`;
      text(line1, SOMME_LINE1.x, baseline(SOMME_LINE1.y, DATA_SIZE), { font: wordFont });
      text(line2, SOMME_LINE2.x, baseline(SOMME_LINE2.y, DATA_SIZE), { font: wordFont });
    }
  }

  // 3. The BPF pill (sous BPF) — the paid amount in figures, auto-fitted to
  //    the light middle of the gradient, centered.
  const figures = fmtFcfa(amount);
  const boldMaxSize = 11;
  const figuresWAtMax = helvBold.widthOfTextAtSize(figures, boldMaxSize) / PT_PER_MM;
  const figuresSize = Math.min(boldMaxSize, (PILL_TEXT_MAX_W / figuresWAtMax) * boldMaxSize);
  const figuresW = helvBold.widthOfTextAtSize(figures, figuresSize) / PT_PER_MM;
  const pillCx = (PILL.x0 + PILL.x1) / 2;
  const pillCy = (PILL.y0 + PILL.y1) / 2;
  text(figures, pillCx - figuresW / 2, baseline(pillCy, figuresSize), { font: { font: helvBold, size: figuresSize }, color: DARK_BLUE });

  // 4. « Mois » — le mois de la DATE, ou les MOIS CHOISIS au guichet.
  //
  // Les mois choisis sont réduits pour tenir sur la ligne pointillée, comme le
  // nom de l'élève ; au-delà du plus petit corps lisible, on ne coupe JAMAIS un
  // nom de mois en deux (un reçu qui nomme à moitié est pire que muet) : le
  // NOMBRE seul est écrit. Un paiement sans mois choisi garde le mois de sa
  // date — un reçu réimprimé d'avant cette colonne ne change donc pas.
  const paidMonths = payment.months ?? [];
  const monthWords = {
    label: (ym: string) => paymentMonthLabel(ym, t),
    count: (n: number) => t.paidMonthsCount.replace('{count}', String(n)),
    rangeTo: t.paidMonthsRangeTo,
  };
  const payDate = payment.date ? new Date(payment.date) : new Date();
  const monthIdx = Number.isNaN(payDate.getTime()) ? new Date().getMonth() : payDate.getMonth();
  const monthKey = MONTH_KEYS[monthIdx] as keyof TranslationDict;
  const monthsText = formatPaidMonths(paidMonths, monthWords) || String(t[monthKey]);
  const monthsShape = paidMonthsShape(paidMonths);
  const monthsCountText =
    monthsShape.kind === 'range' || monthsShape.kind === 'list' ? monthWords.count(monthsShape.count) : '';
  // La ligne pointillée s'arrête à x 99.2 mm ; on vise 98.4 mm. Cette marge de
  // 0,8 mm n'est pas de la prudence gratuite : la largeur d'un texte est mesurée
  // avec les tables d'`Helvetica` de pdf-lib, et les lecteurs la recalculent —
  // 0,5 % d'écart suffisent à faire dépasser d'un demi-millimètre un texte cuit
  // au ras du pointillé (mesuré : 68,1 mm tracés pour 67,7 visés).
  const MOIS_MAX_W = 98.4 - MOIS.x;
  const MOIS_MIN_SIZE = 7;
  /** Le plus petit corps lisible sur la ligne « Motif » (voir point 6). */
  const MOTIF_MIN_SIZE = 7;
  const moisWidthAtFull = helv.widthOfTextAtSize(monthsText, DATA_SIZE) / PT_PER_MM;
  let moisText = monthsText;
  let moisSize = DATA_SIZE;
  if (moisWidthAtFull > MOIS_MAX_W) {
    const shrunk = Math.max(MOIS_MIN_SIZE, (MOIS_MAX_W / moisWidthAtFull) * DATA_SIZE);
    if (helv.widthOfTextAtSize(monthsText, shrunk) / PT_PER_MM <= MOIS_MAX_W) {
      moisSize = shrunk;
    } else if (monthsCountText) {
      moisText = monthsCountText;
    }
  }
  text(moisText, MOIS.x, baseline(MOIS.y, moisSize), { font: { font: helv, size: moisSize } });

  // 5. « Classe » — the grade, centered on the marked spot (no drawn box).
  if (student.grade) {
    const gradeSize = DATA_SIZE;
    const gradeW = helv.widthOfTextAtSize(student.grade, gradeSize) / PT_PER_MM;
    const fit = Math.min(gradeSize, (CLASSE_MAX_W / gradeW) * gradeSize);
    textCentered(student.grade, CLASSE.x, CLASSE.y, { font: helv, size: fit });
  }

  // 6. « Motif » — ce que ce paiement RÈGLE.
  //
  // Le mot vient de la ligne (`paymentMotifOf` : tout ce qui n'est pas un motif
  // connu retombe sur « Frais de scolarité », donc un reçu d'avant la colonne ne
  // change pas). La ligne pointillée s'arrête à x 190 mm — les deux libellés y
  // tiennent largement, mais la MESURE est là : le jour où un motif plus long
  // entre dans la liste fermée, il se réduit au lieu de dépasser sur le papier.
  const motifText = paymentMotifLabel(paymentMotifOf(payment.motif), t);
  const MOTIF_MAX_W = 190 - MOTIF.x;
  const motifWAtFull = helv.widthOfTextAtSize(motifText, DATA_SIZE) / PT_PER_MM;
  const motifSize = motifWAtFull > MOTIF_MAX_W
    ? Math.max(MOTIF_MIN_SIZE, (MOTIF_MAX_W / motifWAtFull) * DATA_SIZE)
    : DATA_SIZE;
  text(motifText, MOTIF.x, baseline(MOTIF.y, motifSize), { font: { font: helv, size: motifSize } });

  // 7. « Date, le … 20 … » — dd/mm/ centered on the dotted line before the
  //    pre-printed « 20 » (no drawn box), then the last two year digits
  //    after the « 20 » (same baseline as the date).
  const { ddmm, yy } = fmtDateShort(payment.date);
  if (ddmm) textCentered(ddmm, DATE.x, DATE.y, { font: helv, size: DATA_SIZE });
  if (yy) text(yy, DATE_PRINTED_20_X1 + 1, baseline(DATE.y, DATA_SIZE), { font: { font: helv, size: DATA_SIZE } });

  // 7. The « N° » box — the receipt number, centered.
  const nBoxCx = (NBOX.x0 + NBOX.x1) / 2;
  const nBoxCy = (NBOX.y0 + NBOX.y1) / 2;
  const nSize = 11;
  const nW = helvBold.widthOfTextAtSize(receiptNo, nSize) / PT_PER_MM;
  text(receiptNo, nBoxCx - nW / 2, baseline(nBoxCy, nSize), { font: { font: helvBold, size: nSize } });

  const bytes = await pdf.save();
  return { bytes, filename: `Recu_${receiptNo}_${student.name.replace(/\s+/g, '_')}.pdf` };
}

/**
 * Prepares the official receipt and opens its preview. Download is explicit
 * in the preview, using these exact bytes (no second PDF generation).
 */
export function downloadPreparedReceipt(receipt: GeneratedReceipt): void {
  downloadBytes(receipt.bytes, receipt.filename);
}

export async function generatePaymentReceiptPdf(opts: ReceiptDataOptions): Promise<void> {
  const receipt = await buildParentReceiptPdf(opts);
  showReceiptPreview(receipt, opts);
}