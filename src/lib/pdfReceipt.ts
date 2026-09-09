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
 *   • « M » (the payer) gets the parent/guardian name;
 *   • « La somme de : » gets the paid amount IN WORDS (French, capitalized);
 *   • the BPF gradient pill (sous BPF) gets the paid amount IN FIGURES,
 *     « … FCFA »;
 *   • « Mois » gets the payment month;
 *   • « Classe » gets the student grade — written inside a drawn blue cell
 *     (same style as the printed « N° » box) placed where the Direction
 *     marks the class entry;
 *   • « Motif » gets the payment reason;
 *   • « Date, le … 20 … » gets the payment date: dd/mm/ inside a drawn blue
 *     cell on the dotted line, then the last two year digits written after
 *     the pre-printed « 20 »;
 *   • the « N° » box gets the receipt number.
 *
 * No French/English labels are drawn — they are printed on the paper template
 * itself; only `lang` localizes the month name and the payment motif.
 */
import type { Student, Payment } from './useSupabaseData';
import { montantEnLettres } from './pdfPayrollBulletin';
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
//   • the CLASS cell is a DRAWN box (the Direction circles it on the paper)
//     — the grade is written inside it. The cell bbox comes from the red
//     square the Direction drew on the filled receipt (x 175.2–186.7,
//     y 110.1–123.2, center 180.95, 116.65), at the right end of the
//     « Classe : » dotted line;
//   • the DATE cell is the same drawn box on the « Date, le » dotted line,
//     placed before the pre-printed « 20 »: x 102.2–117.8, y 135.5–146.5
//     (the Direction's red square was x 107.2–115.5 — widened to fit
//     « dd/mm/ » at the larger size);
//   • the BPF box: dark blue label block x 158–192, y 20–33 (white « BPF »
//     text at y 24–32), then the gradient pill x 158–190.5, y 36–45.5 — dark
//     blue at the ends, LIGHT in the middle (x 162.7–184.9) where the paid
//     amount in figures is written, centered on (174.3, 40.8).
export const LINE_M = { x: 20.5, y: 82.0 };
export const SOMME_LINE1 = { x: 54.5, y: 92.9 };
export const SOMME_LINE2 = { x: 13.5, y: 105.8 };
export const MOIS = { x: 31.5, y: 114.4 };
export const MOTIF = { x: 33.0, y: 125.7 };
/** Drawn blue cell on the « Classe : » dotted line (Direction's marked spot). */
export const CLASSE_BOX = { x0: 175.2, x1: 186.7, y0: 110.1, y1: 123.2 };
/** Drawn blue cell on the « Date, le » dotted line, before the « 20 ». */
export const DATE_BOX = { x0: 102.2, x1: 117.8, y0: 135.5, y1: 146.5 };
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
/** The vivid blue of the printed « N° » box outline (sampled on the raster). */
const BOX_BLUE = { r: 0.08, g: 0.33, b: 0.91 };
/** Shared size for the handwritten-style entries (the letters were too small). */
const DATA_SIZE = 12.5;

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

function triggerBrowserDownload(bytes: Uint8Array, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
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

  /** Draws a white cell with the form's blue outline (N° box style). */
  const drawCell = (b: { x0: number; x1: number; y0: number; y1: number }): void => {
    page.drawRectangle({
      x: mmToPdfX(b.x0),
      y: mmToPdfY(b.y1),
      width: (b.x1 - b.x0) * PT_PER_MM,
      height: (b.y1 - b.y0) * PT_PER_MM,
      color: rgb(1, 1, 1),
      borderColor: rgb(BOX_BLUE.r, BOX_BLUE.g, BOX_BLUE.b),
      borderWidth: 2,
    });
  };

  /** Centered text helper (for the cells). */
  const textCentered = (str: string, cx: number, cy: number, font: PtFont): void => {
    const wMm = font.font.widthOfTextAtSize(str, font.size) / PT_PER_MM;
    text(str, cx - wMm / 2, baseline(cy, font.size), { font });
  };

  // 1. « M » — the payer (parent/guardian, falling back to the student).
  const payer = student.parentName || student.name || '—';
  text(payer, LINE_M.x, baseline(LINE_M.y, DATA_SIZE), { font: { font: helv, size: DATA_SIZE } });

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

  // 4. « Mois ».
  const payDate = payment.date ? new Date(payment.date) : new Date();
  const monthIdx = Number.isNaN(payDate.getTime()) ? new Date().getMonth() : payDate.getMonth();
  const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][monthIdx] as keyof TranslationDict;
  text(String(t[monthKey]), MOIS.x, baseline(MOIS.y, DATA_SIZE), { font: { font: helv, size: DATA_SIZE } });

  // 5. « Classe » — the grade written INSIDE the drawn cell on the dotted line.
  if (student.grade) {
    drawCell(CLASSE_BOX);
    const gradeSize = DATA_SIZE;
    const gradeW = helv.widthOfTextAtSize(student.grade, gradeSize) / PT_PER_MM;
    const usableW = CLASSE_BOX.x1 - CLASSE_BOX.x0 - 2.8;
    const fit = Math.min(gradeSize, (usableW / gradeW) * gradeSize);
    const clsCx = (CLASSE_BOX.x0 + CLASSE_BOX.x1) / 2;
    const clsCy = (CLASSE_BOX.y0 + CLASSE_BOX.y1) / 2;
    textCentered(student.grade, clsCx, clsCy, { font: helv, size: fit });
  }

  // 6. « Motif » — the payment reason.
  text(t.pdfMotifTuition, MOTIF.x, baseline(MOTIF.y, DATA_SIZE), { font: { font: helv, size: DATA_SIZE } });

  // 7. « Date, le … 20 … » — dd/mm/ inside the drawn cell, then the last two
  //    year digits after the pre-printed « 20 » (same baseline as the cell).
  const { ddmm, yy } = fmtDateShort(payment.date);
  const dateCy = DATE_BOX.y0 + 4.3; // visual center of the cell (its own center is 141.0)
  if (ddmm) {
    drawCell(DATE_BOX);
    const dateCx = (DATE_BOX.x0 + DATE_BOX.x1) / 2;
    textCentered(ddmm, dateCx, dateCy, { font: helv, size: DATA_SIZE });
  }
  if (yy) text(yy, DATE_PRINTED_20_X1 + 1, baseline(dateCy, DATA_SIZE), { font: { font: helv, size: DATA_SIZE } });

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
 * Generates and triggers the download of the official parent payment receipt.
 * Same contract as before (callers await it); the bytes are available through
 * {@link buildParentReceiptPdf} for tests.
 */
export async function generatePaymentReceiptPdf(opts: ReceiptDataOptions): Promise<void> {
  const { bytes, filename } = await buildParentReceiptPdf(opts);
  triggerBrowserDownload(bytes, filename);
}