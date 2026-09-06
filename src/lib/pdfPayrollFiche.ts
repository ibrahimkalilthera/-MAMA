/**
 * Fiche individuelle de paiement de salaire — employee payroll receipt.
 *
 * Unlike the administration bulletin (which is re-drawn from code), this
 * document uses THE SCHOOL'S OWN paper fiche as a template:
 * `public/templates/fiche-paiement-salaire.pdf` (provided by the Direction).
 * The generator loads that exact PDF — raster form with the school emblem,
 * header, the 6-column payroll table (Prénom et Nom | Fonction/Poste +
 * Salaire de base | Primes/Indemnités | Retenues + Salaire net payé | Mode
 * de paiement | Signature employé) and the CACHET / DATE DE PAIEMENT footer
 * — and only prints the employee's monthly data on top of it:
 *
 *   • the PÉRIODE box gets the current month + year;
 *   • the first table row carries the employee's payment (name, position,
 *     base salary, total allowances, no deductions, net paid = base +
 *     allowances — the INPS/AMO contributions stay exclusive to the
 *     administration bulletin);
 *   • the other five rows stay blank, as on the paper form;
 *   • the DATE DE PAIEMENT line gets today's date.
 *
 * No French/English labels are drawn — they are printed on the paper
 * template itself; only `lang` localizes the month name and date format.
 */
import type { TranslationDict } from '../i18n/translations';
import { translations } from '../i18n/translations';
import { splitName } from './pdfPayrollBulletin';
import type { Staff } from './useSupabaseData';

export interface EmployeeFicheOptions {
  staffMember: Staff;
  lang?: 'en' | 'fr';
  /**
   * Override for the official paper template bytes (tests inject the file
   * directly). Defaults to fetching `/templates/fiche-paiement-salaire.pdf`.
   */
  template?: Uint8Array | ArrayBuffer;
}

export interface GeneratedFiche {
  bytes: Uint8Array;
  filename: string;
}

/** Template asset served from the app's public directory. */
const TEMPLATE_URL = 'templates/fiche-paiement-salaire.pdf';

// ─── Template geometry (mm from the top-left of the scanned form) ───────────
// Calibrated against the paper fiche raster (1240×1240 px on a 210.3 × 209.8
// mm page). Cell borders were located by pixel scans of the printed grid.

/** PÉRIODE input box on the paper form. */
const PERIOD_BOX = { x: 85.5, y: 62.4, right: 148.7, bottom: 69.9 };

/** 6-column payroll table: header band then six ~9.5 mm tall data rows. */
const TABLE = {
  top: 73.4, // top of the dark header band
  headerBottom: 89.8, // bottom of the header / top of row 1
  bottom: 146.4, // bottom border of the table (last grid line)
  columns: [4.3, 41.8, 75.5, 106.6, 136.6, 165.4, 204.0], // vertical separators
  rowCount: 6,
};
const FIRST_ROW = { top: TABLE.headerBottom, bottom: 99.3, center: 94.55 };

/** DATE DE PAIEMENT label ends at x≈51 mm; its underline runs 23.1–119.1 mm. */
const DATE_LINE = { labelEnd: 51.5, baseline: 179.2 };

const ROW_TOP_LINE = FIRST_ROW.top + 3.3; // baseline of the upper line in row 1
const ROW_BOTTOM_LINE = FIRST_ROW.bottom - 2.2; // baseline of the lower line in row 1

const PT_PER_MM = 72 / 25.4;

/** Inks that read like typed entries on the paper form. */
const INK = { r: 0.09, g: 0.12, b: 0.2 }; // near-black slate #172033
const BLUE = { r: 30 / 255, g: 58 / 255, b: 138 / 255 }; // template deep blue #1E3A8A
const MUTED = { r: 0.42, g: 0.46, b: 0.53 }; // gray for the empty-deduction dash

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
  if (!res.ok) throw new Error(`La fiche modèle est introuvable (HTTP ${res.status}).`);
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

/**
 * Formats an amount like the school writes it on the fiche: thin spaces as
 * thousands separators + the FCFA unit (the receipt form itself stays free of
 * any currency glyph, so the unit must ride with each figure).
 */
function fmtFcfa(value: number): string {
  return `${value.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;
}

/**
 * Generates the individual salary payment record: the school's paper fiche
 * with the employee's current-month data stamped on it. In the browser it
 * triggers the download; the resulting bytes are always returned (tests use
 * the return value and inject the template file).
 */
export async function generateEmployeeFichePdf({
  staffMember,
  lang = 'fr',
  template,
}: EmployeeFicheOptions): Promise<GeneratedFiche> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const now = new Date();
  const monthIdx = now.getMonth();
  const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][monthIdx] as keyof TranslationDict;
  const monthName = String(t[monthKey]);
  const periodLabel = `${monthName} ${now.getFullYear()}`;
  const todayLabel = now.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB');

  const base = staffMember.salary;
  const totalAllowances =
    (staffMember.travelAllowance ?? 0) +
    (staffMember.communicationAllowance ?? 0) +
    (staffMember.housingAllowance ?? 0);
  // The employee fiche carries NO social contributions: net = base + indemnités.
  const net = base + totalAllowances;

  const { lastName, firstName } = splitName(staffMember.name);
  const dash = '—';
  const displayName = firstName === '—' ? lastName : `${firstName} ${lastName}`;

  // Load the school's own paper fiche — the document that is downloaded IS
  // the provided PDF, with the data printed over it.
  const templateBytes = await loadTemplateBytes(template);
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPage(0);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Visible page box: the template MediaBox starts below y=0 (CropBox offset),
  // so coordinates are anchored to the TOP of the MediaBox.
  const media = page.getMediaBox();
  const topPt = media.y + media.height;

  const mmToPdfX = (mm: number) => mm * PT_PER_MM;
  const mmToPdfY = (mm: number) => topPt - mm * PT_PER_MM;
  const text = (
    str: string,
    xMm: number,
    yMm: number,
    { font, color = INK }: { font: PtFont; color?: { r: number; g: number; b: number } },
  ): void => {
    page.drawText(str, { x: mmToPdfX(xMm), y: mmToPdfY(yMm), size: font.size, font: font.font, color: rgb(color.r, color.g, color.b) });
  };

  // 1. PÉRIODE box — month + year, centered in the printed input box.
  const periodFont = { font: helvBold, size: 11 };
  const periodCenterX = (PERIOD_BOX.x + PERIOD_BOX.right) / 2;
  const periodWidth = helvBold.widthOfTextAtSize(periodLabel, 11) / PT_PER_MM;
  text(periodLabel, periodCenterX - periodWidth / 2, 67.0, { font: periodFont, color: INK });

  // 2. First payroll row — the current month's payment.
  const nameFont: PtFont = { font: helvBold, size: 10 };
  const smallFont: PtFont = { font: helv, size: 8 };
  const boldFont: PtFont = { font: helvBold, size: 8.5 };
  const nameMaxW = TABLE.columns[1]! - TABLE.columns[0]! - 8;
  const nameWidth = helvBold.widthOfTextAtSize(displayName, 10) / PT_PER_MM;

  // Column 1 — Prénom et Nom: one centered line, or two lines when needed.
  if (nameWidth <= nameMaxW) {
    text(displayName, TABLE.columns[0]! + 4.5, FIRST_ROW.center + 1.7, { font: nameFont });
  } else {
    const words = displayName.split(' ');
    let line1 = '';
    let line2 = '';
    for (const w of words) {
      const candidate = line1 ? `${line1} ${w}` : w;
      if (!line1 || helvBold.widthOfTextAtSize(candidate, 9) / PT_PER_MM <= nameMaxW) line1 = candidate;
      else line2 = line2 ? `${line2} ${w}` : w;
    }
    if (!line2) {
      text(displayName, TABLE.columns[0]! + 4.5, FIRST_ROW.center + 1.7, { font: { font: helvBold, size: 8 }, color: INK });
    } else {
      text(line1, TABLE.columns[0]! + 4.5, ROW_TOP_LINE + 0.9, { font: { font: helvBold, size: 9 }, color: INK });
      text(line2, TABLE.columns[0]! + 4.5, ROW_TOP_LINE + 4.6, { font: { font: helvBold, size: 9 }, color: INK });
    }
  }

  // Column 2 — Fonction / Poste (upper line) + Salaire de base (lower line).
  const c2Left = TABLE.columns[1]! + 4.2;
  const c2Right = TABLE.columns[2]! - 4.2;
  const position = staffMember.position || dash;
  const posW = helv.widthOfTextAtSize(position, 8) / PT_PER_MM;
  text(posW > c2Right - c2Left ? `${position.slice(0, Math.max(12, Math.floor((c2Right - c2Left) * 0.8)))}…` : position, c2Left, ROW_TOP_LINE, { font: smallFont });
  const baseStr = fmtFcfa(base);
  text(baseStr, c2Right - helvBold.widthOfTextAtSize(baseStr, 8.5) / PT_PER_MM, ROW_BOTTOM_LINE, { font: boldFont });

  // Column 3 — Primes / Indemnités: total of the three tracked allowances.
  const c3Right = TABLE.columns[3]! - 4.2;
  if (totalAllowances > 0) {
    const allowStr = fmtFcfa(totalAllowances);
    text(allowStr, c3Right - helvBold.widthOfTextAtSize(allowStr, 8.5) / PT_PER_MM, FIRST_ROW.center + 1.5, { font: boldFont });
  } else {
    text(dash, c3Right - 2, FIRST_ROW.center + 1.5, { font: smallFont, color: MUTED });
  }

  // Column 4 — Retenues (none on the employee fiche) / Salaire net payé.
  const c4Left = TABLE.columns[3]! + 4.2;
  text(dash, c4Left, ROW_TOP_LINE, { font: smallFont, color: MUTED });
  const netStr = fmtFcfa(net);
  text(netStr, c4Left, ROW_BOTTOM_LINE, { font: { font: helvBold, size: 9 }, color: BLUE });

  // Columns 5 (Mode de paiement) and 6 (Signature employé) stay blank — they
  // are completed by hand when the employee signs the receipt.

  // 3. Footer — DATE DE PAIEMENT : today's date, right after the label.
  const dateFont = { font: helvBold, size: 10 };
  text(todayLabel, DATE_LINE.labelEnd + 4.5, DATE_LINE.baseline, { font: dateFont, color: INK });

  const bytes = await pdf.save();
  const safeName = staffMember.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const periodStamp = `${now.getFullYear()}-${String(monthIdx + 1).padStart(2, '0')}`;
  const filename = `Fiche_Paie_${safeName}_${periodStamp}.pdf`;
  triggerBrowserDownload(bytes, filename);
  return { bytes, filename };
}
