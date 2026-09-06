/**
 * Official individual salary payment record (Fiche individuelle de paiement
 * de salaire) PDF for school employees — mirrors the school's paper fiche:
 * logo emblem with the blue/gold header swoosh, the school name, the title
 * pill, the PÉRIODE box, the 6-column payroll table (name / role + base
 * salary / allowances / deductions + net paid / payment method / employee
 * signature) and the footer with CACHET DE LA DIRECTION, DATE DE PAIEMENT
 * and the watermarked seal box.
 *
 * Unlike the administration bulletin (which carries the INPS 3,60 % and AMO
 * 3,06 % social contributions), this fiche shows NO contributions — the
 * Retenues column stays empty and the net salary paid is the base salary
 * plus the allowances. The INPS/AMO rates remain exclusive to the bulletin.
 */
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';
import type { Staff } from './useSupabaseData';
import { splitName } from './pdfPayrollBulletin';
import { drawSchoolStamp } from './pdfStamp';

// ─── Fiche geometry (A4 portrait, mm) ────────────────────────────────────────

const PAGE_W = 210;
const MARGIN = 10;
// 6 payroll columns — widths sum to 190 (MARGIN → 200)
const COLUMNS = [
  { x: MARGIN, w: 40 },      // Prénom et Nom
  { x: 50, w: 34 },          // Fonction / Poste + Salaire de base
  { x: 84, w: 28 },          // Primes / Indemnités
  { x: 112, w: 30 },         // Retenues + Salaire net payé
  { x: 142, w: 32 },         // Mode de paiement
  { x: 174, w: 26 },         // Signature employé
];
const TABLE_TOP = 64;
const HEADER_H = 12;
const ROW_H = 16;
const ROWS = 3; // the paper template leaves three lines
const TABLE_BOTTOM = TABLE_TOP + HEADER_H + ROWS * ROW_H; // 124

export interface EmployeeFicheOptions {
  staffMember: Staff;
  lang?: 'en' | 'fr';
  /** Uploaded school logo (data URL) — drawn in the emblem and the watermark box. */
  schoolLogo?: string | null;
}

/** jsPDF's translate() lives on an API mixin not merged into the class typings. */
interface TranslateableDoc {
  translate: (x: number, y: number) => void;
}

/** Splits long text on word boundaries for a given max width (mm). */
function wrapText(
  doc: { splitTextToSize?: (text: string, maxWidth: number) => string[] | undefined },
  text: string,
  maxWidth: number,
): string[] {
  if (typeof doc.splitTextToSize === 'function') {
    const lines = doc.splitTextToSize(text, maxWidth);
    if (lines && lines.length > 0) return lines;
  }
  return [text];
}

/** 5-point star polygon centered on (cx, cy) — used under the school name. */
function starPoints(cx: number, cy: number, outer: number, inner: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  return pts;
}

// Decorative helpers — every call is guarded so a minimal jsPDF surface (or a
// unit-test fake) can never crash the document; icons are small and optional.

function drawStar(
  doc: { polygon?: (pts: number[], style: string) => void; circle?: (x: number, y: number, r: number, style: string) => void },
  cx: number,
  cy: number,
): void {
  if (typeof doc.polygon === 'function') {
    doc.polygon(starPoints(cx, cy, 1.5, 0.65), 'F');
  } else if (typeof doc.circle === 'function') {
    doc.circle(cx, cy, 1.3, 'F');
  }
}

function drawPencilIcon(
  doc: {
    saveGraphicsState?: () => void;
    translate?: (x: number, y: number) => void;
    rotate?: (angle: number) => void;
    triangle?: (x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, style: string) => void;
    rect?: (x: number, y: number, w: number, h: number, style: string) => void;
    restoreGraphicsState?: () => void;
  },
): void {
  if (
    typeof doc.saveGraphicsState !== 'function' ||
    typeof doc.translate !== 'function' ||
    typeof doc.rotate !== 'function' ||
    typeof doc.triangle !== 'function' ||
    typeof doc.rect !== 'function' ||
    typeof doc.restoreGraphicsState !== 'function'
  ) {
    return;
  }
  doc.saveGraphicsState();
  (doc as unknown as TranslateableDoc).translate(17, 260);
  doc.rotate(45); // diagonal writing pencil
  doc.triangle(-1.1, 1.7, 1.1, 1.7, 0, 2.8, 'F'); // lead tip
  doc.rect(-1.0, -1.8, 2.0, 3.5, 'F'); // body
  doc.restoreGraphicsState();
}

function drawCalendarIcon(
  doc: {
    roundedRect?: (x: number, y: number, w: number, h: number, rx: number, ry: number, style: string) => void;
    circle?: (x: number, y: number, r: number, style: string) => void;
  },
): void {
  if (typeof doc.roundedRect !== 'function') return;
  doc.roundedRect(-2.5, -1.4, 5, 3.3, 0.5, 0.5, 'F'); // face
  if (typeof doc.circle === 'function') {
    doc.circle(-1.2, -1.7, 0.45, 'F'); // binder rings
    doc.circle(1.2, -1.7, 0.45, 'F');
  }
}

/**
 * Generates and triggers download of the official individual salary payment
 * record (fiche de paiement de salaire) for a regular employee, modeled on
 * the school's paper template.
 */
export async function generateEmployeeFichePdf({
  staffMember,
  lang = 'fr',
  schoolLogo = null,
}: EmployeeFicheOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Palette (matches the paper fiche: deep blue, gold accent, light blue)
  const BLUE = { r: 30, g: 58, b: 138 }; // #1E3A8A
  const GOLD = { r: 251, g: 191, b: 36 }; // #FBBF24
  const INK = { r: 15, g: 23, b: 42 }; // #0F172A
  const GRAY = { r: 100, g: 116, b: 139 }; // #64748B
  const BLUE_LIGHT = { r: 219, g: 234, b: 254 }; // #DBEAFE
  const BORDER = { r: 191, g: 219, b: 254 }; // #BFDBFE
  const WATERMARK = { r: 147, g: 197, b: 253 }; // #93C5FD
  const WHITE = { r: 255, g: 255, b: 255 };

  const fmt = (v: number) => `${v.toLocaleString('fr-FR')} FCFA`;

  // ── Period (current month) ──
  const now = new Date();
  const monthIdx = now.getMonth();
  const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][monthIdx] as keyof TranslationDict;
  const monthName = String(t[monthKey]);
  const periodYear = now.getFullYear();
  const dmy = (d: Date) => d.toLocaleDateString('fr-FR');

  // ── Payroll figures — no social contributions on the employee fiche ──
  const base = staffMember.salary;
  const totalAllowances =
    (staffMember.travelAllowance ?? 0) +
    (staffMember.communicationAllowance ?? 0) +
    (staffMember.housingAllowance ?? 0);
  const net = base + totalAllowances;

  const { lastName, firstName } = splitName(staffMember.name);
  const dash = '—';
  const name = firstName === '—' ? lastName : `${firstName} ${lastName}`;

  // Sheet frame (the white fiche sheet with its thin blue border)
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  if (typeof doc.setLineWidth === 'function') doc.setLineWidth(0.6);
  doc.roundedRect(5, 5, PAGE_W - 10, 287, 3, 3, 'D');
  if (typeof doc.setLineWidth === 'function') doc.setLineWidth(0.2);

  // 1. Header: blue/gold swoosh behind the emblem, school name, title pill
  doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
  doc.roundedRect(2, -14, 62, 20, 10, 10, 'F');
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.roundedRect(-3, -12, 70, 22, 11, 11, 'F');

  // Emblem: white disc, uploaded logo inside when available
  doc.setFillColor(WHITE.r, WHITE.g, WHITE.b);
  doc.circle(17, 16, 10, 'F');
  if (schoolLogo) {
    try {
      doc.addImage(schoolLogo, schoolLogo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 9, 8, 16, 16);
    } catch {
      // a broken logo must never break the fiche
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
    doc.text('M.T.', 17, 18.5, { align: 'center' });
  }
  doc.setDrawColor(WHITE.r, WHITE.g, WHITE.b);
  if (typeof doc.setLineWidth === 'function') doc.setLineWidth(1.1);
  doc.circle(17, 16, 10, 'S');
  if (typeof doc.setLineWidth === 'function') doc.setLineWidth(0.2);

  // School name (top right, dark blue on white), gold star centered under it
  doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(t.pdfFicheSubtitle, 196, 11.5, { align: 'right' });
  doc.setFontSize(14.5);
  doc.text(t.pdfFicheSchoolName, 196, 19, { align: 'right' });
  doc.setFillColor(GOLD.r, GOLD.g, GOLD.b);
  drawStar(doc, 168, 24);

  // Title pill
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.roundedRect(35, 30, 140, 10, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text(t.pdfFicheTitle, 105, 37, { align: 'center' });

  // 2. PÉRIODE box (prefilled with the current month)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  doc.text(t.pdfFichePeriod, 16, 54);
  doc.setFillColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  doc.roundedRect(58, 47.8, 100, 9.5, 2, 2, 'FD');
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text(`${monthName} ${periodYear}`, 63, 54.5);

  // 3. Payroll table
  const colCenter = (i: number) => COLUMNS[i]!.x + COLUMNS[i]!.w / 2;
  const colLeft = (i: number) => COLUMNS[i]!.x + 3;

  // Header row (dark blue, white labels)
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.rect(MARGIN, TABLE_TOP, 190, HEADER_H, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.8);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text(t.pdfFicheColName, colCenter(0), TABLE_TOP + 8, { align: 'center' });
  doc.text(t.pdfFicheColRole, colCenter(1), TABLE_TOP + 5.5, { align: 'center' });
  doc.text(t.pdfFicheColBaseSalary, colCenter(1), TABLE_TOP + 10.5, { align: 'center' });
  doc.text(t.pdfFicheColAllowances, colCenter(2), TABLE_TOP + 5.5, { align: 'center' });
  doc.text(t.pdfFicheColDeductions, colCenter(3), TABLE_TOP + 5.5, { align: 'center' });
  doc.text(t.pdfFicheColNetPaid, colCenter(3), TABLE_TOP + 10.5, { align: 'center' });
  doc.text(t.pdfFicheColPayment, colCenter(4), TABLE_TOP + 8, { align: 'center' });
  doc.text(t.pdfFicheColSignature, colCenter(5), TABLE_TOP + 8, { align: 'center' });

  // Column separators
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  for (let i = 1; i < COLUMNS.length; i++) {
    doc.line(COLUMNS[i]!.x, TABLE_TOP, COLUMNS[i]!.x, TABLE_BOTTOM);
  }
  // Row separators
  for (let r = 1; r < ROWS; r++) {
    doc.line(MARGIN, TABLE_TOP + HEADER_H + r * ROW_H, 200, TABLE_TOP + HEADER_H + r * ROW_H);
  }

  // First row: the employee's data; the two lower lines stay blank like the paper template.
  // Columns 2 and 4 stack a small gray label above its value (guaranteed to
  // stay inside the cell — no long single-line label can overflow the column).
  const row1Top = TABLE_TOP + HEADER_H; // 76
  const rowMid = row1Top + ROW_H / 2; // 84 — vertical center of the row

  // Column 1 — Prénom et Nom (bold, vertically centered)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(INK.r, INK.g, INK.b);
  const nameLines = wrapText(doc as never, name, COLUMNS[0]!.w - 6);
  doc.text(nameLines, colLeft(0), rowMid - (nameLines.length - 1) * 2);

  // Column 2 — Fonction / Poste + Salaire de base
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(INK.r, INK.g, INK.b);
  const roleLines = wrapText(doc as never, staffMember.position || dash, COLUMNS[1]!.w - 6);
  doc.text(roleLines, colLeft(1), row1Top + 3.6 - (roleLines.length - 1) * 2);
  doc.setFontSize(6.2);
  doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
  doc.text(t.pdfFicheBaseSalary, colLeft(1), row1Top + 8.6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.text(fmt(base), colLeft(1), row1Top + 13.4);

  // Column 3 — Primes / Indemnités (total of the three tracked allowances)
  doc.setFont('helvetica', 'normal');
  if (totalAllowances > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(fmt(totalAllowances), colCenter(2), rowMid, { align: 'center' });
  } else {
    doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
    doc.text(dash, colCenter(2), rowMid, { align: 'center' });
  }

  // Column 4 — Retenues (empty on the employee fiche) / Salaire net payé
  doc.setFontSize(6.2);
  doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
  doc.text(t.pdfFicheDeductions, colLeft(3), row1Top + 3.4);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
  doc.text(dash, colLeft(3), row1Top + 7.3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.2);
  doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
  doc.text(t.pdfFicheNetPaid, colLeft(3), row1Top + 10.8);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  doc.text(fmt(net), colLeft(3), row1Top + 14.4);

  // Column 5 — Mode de paiement (vertically centered)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(INK.r, INK.g, INK.b);
  const payLines = wrapText(doc as never, staffMember.bankDetails || dash, COLUMNS[4]!.w - 6);
  doc.text(payLines, colLeft(4), rowMid - (payLines.length - 1) * 2);

  // 4. Footer: cachet de la direction (with the school cachet), date de paiement, seal box
  // Cachet de la direction — pencil icon + label + line, the school stamp on the line
  doc.setFillColor(BLUE_LIGHT.r, BLUE_LIGHT.g, BLUE_LIGHT.b);
  doc.circle(17, 260, 3.2, 'F');
  doc.setFillColor(INK.r, INK.g, INK.b);
  drawPencilIcon(doc as never);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  doc.text(t.pdfFicheCachet, 24, 260.5);
  doc.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  doc.line(24, 264.5, 104, 264.5);
  await drawSchoolStamp(doc, 68, 266.5, 16);

  // Date de paiement — calendar icon + label + prefilled date + line
  doc.setFillColor(BLUE_LIGHT.r, BLUE_LIGHT.g, BLUE_LIGHT.b);
  doc.circle(17, 278, 3.2, 'F');
  doc.setFillColor(INK.r, INK.g, INK.b);
  const docTranslate = (doc as unknown as TranslateableDoc).translate;
  if (
    typeof doc.saveGraphicsState === 'function' &&
    typeof docTranslate === 'function' &&
    typeof doc.restoreGraphicsState === 'function'
  ) {
    doc.saveGraphicsState();
    docTranslate(17, 278);
    drawCalendarIcon(doc as never);
    doc.restoreGraphicsState();
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
  doc.text(`${t.pdfFichePaymentDate} ${dmy(now)}`, 24, 278.5);
  doc.line(24, 282.5, 104, 282.5);

  // Watermarked seal box (right): faint school logo on a dashed blue box
  doc.setDrawColor(BLUE.r, BLUE.g, BLUE.b);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.roundedRect(112, 254, 86, 34, 3, 3, 'D');
  doc.setLineDashPattern([], 0);
  if (schoolLogo) {
    try {
      const format = schoolLogo.startsWith('data:image/png') ? 'PNG' : 'JPEG';
      const gState = (doc as unknown as { GState?: new (opts: { opacity: number }) => unknown }).GState;
      const setGState = (doc as unknown as { setGState?: (s: unknown) => void }).setGState;
      if (typeof gState === 'function' && typeof setGState === 'function') {
        setGState(new gState({ opacity: 0.12 }));
        doc.addImage(schoolLogo, format, 137, 253, 36, 36);
        setGState(new gState({ opacity: 1 }));
      } else {
        doc.addImage(schoolLogo, format, 137, 253, 36, 36);
      }
    } catch {
      /* never break the fiche because of the watermark */
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(WATERMARK.r, WATERMARK.g, WATERMARK.b);
    doc.text('M.T.', 155, 272, { align: 'center' });
  }

  // 5. Decorative blue band at the bottom edge
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.roundedRect(0, 291, PAGE_W, 9, 5, 5, 'F');

  const safeName = staffMember.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const periodStamp = `${periodYear}-${String(monthIdx + 1).padStart(2, '0')}`;
  doc.save(`Fiche_Paie_${safeName}_${periodStamp}.pdf`);
}