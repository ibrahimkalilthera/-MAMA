/**
 * Bulletin de paie mensuelle — official monthly payslip for school
 * administration members (added via "Ajouter un membre de l'administration").
 *
 * Like the employee fiche, this document is THE SCHOOL'S OWN paper bulletin:
 * `public/templates/bulletin-paie-mensuelle.pdf` (the exact PDF provided by
 * the Direction). The generator loads that template — raster form with the
 * school emblem, the blue banner "BULLETIN DE PAIE Mensuelle", the period
 * box (MOIS DE / DU / AU), the identity grid (Nom, Prénom, Fonction, Date
 * d'entrée | Catégorie, N°INPS, Situation Familiale, Nbre Enfants), the
 * earnings & deductions table (LIBELLES / TAUX / MONTANT with the INPS and
 * AMO rows), the "Montant en toutes lettres" line, the Mode de Paiement /
 * N°Compte box and the L'EMPLOYÉ / L'EMPLOYEUR signature blocks — and only
 * prints the member's monthly data on top of it:
 *
 *   • the period box gets the current month + year and the first/last day
 *     of the month (Du / Au);
 *   • the identity grid gets the member's name, position, hire date, INPS
 *     number, family status and children count;
 *   • the MONTANT column of the table gets the payroll figures: base
 *     salary, the three indemnities, Total Brut, the INPS and AMO
 *     contributions, Total Cotisation, Salaire Net and Net à Percevoir.
 *     The TAUX column (3,60 % / 3,06 %) is printed on the paper template —
 *     nothing is stamped there;
 *   • the "Montant en toutes lettres" line gets the net amount in words;
 *   • the Mode de Paiement / N°Compte box gets the payment data;
 *   • the school cachet image is drawn over the L'EMPLOYEUR signature block.
 *
 * The INPS and AMO contribution rates are the legal Malian rates printed on
 * the school's official bulletin — they are frozen constants on purpose and
 * must NOT be edited (see INPS_RATE / AMO_RATE below).
 */
import type { TranslationDict } from '../i18n/translations';
import { translations } from '../i18n/translations';
import { drawSchoolStamp } from './pdfStamp';
import type { Staff } from './useSupabaseData';

/**
 * Employee social contributions (Mali) — fixed legal rates, each computed on
 * the BASE salary, exactly as written on the school's bulletin template:
 *   • INPS (retraite)                       : 3,60 % du salaire de base
 *   • AMO (assurance maladie obligatoire)   : 3,06 % du salaire de base
 * ⚠️ Ces pourcentages de cotisation ne doivent pas être modifiés.
 */
export const INPS_RATE = 0.036; // 3,60 %
export const AMO_RATE = 0.0306; // 3,06 %

/** 0.036 → "3,60" — French decimal formatting for the TAUX column.
 *  (The ×100 first keeps toFixed() away from the binary-float wobble:
 *  0.036.toFixed(2) would round to "0.04" — 0.036×100 = 3.600…5 → "3.60".) */
export const formatRate = (rate: number): string =>
  `${(rate * 100).toFixed(2).replace('.', ',')}`;

// ─── Montant en toutes lettres (French, FCFA has no decimals) ───────────────

const UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept',
  'dix-huit', 'dix-neuf',
];

function under100(n: number): string {
  if (n < 20) return UNITS[n]!;
  if (n < 70) {
    const tens = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'][Math.floor(n / 10)]!;
    const u = n % 10;
    if (u === 0) return tens;
    if (u === 1) return `${tens} et un`;
    return `${tens}-${UNITS[u]}`;
  }
  if (n < 80) return n === 71 ? 'soixante et onze' : `soixante-${under100(n - 60)}`;
  if (n === 80) return 'quatre-vingts';
  if (n === 81) return 'quatre-vingt-un';
  return `quatre-vingt-${under100(n - 80)}`;
}

function under1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  let s = '';
  if (h === 1) s = 'cent';
  else if (h > 1) s = `${under100(h)} cent`;
  if (r > 0) return s ? `${s} ${under100(r)}` : under100(r);
  return h > 1 ? `${s}s` : s; // "deux cents" when nothing follows
}

/**
 * Converts an integer FCFA amount to French words, e.g. 120000 →
 * "cent vingt mille". Handles the classic traps: "vingt et un",
 * "soixante et onze", "quatre-vingt-un", "quatre-vingts" vs
 * "quatre-vingt mille", "deux cents" vs "deux cent mille".
 */
export function montantEnLettres(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'zéro';
  const parts: string[] = [];
  const milliards = Math.floor(n / 1_000_000_000);
  const millions = Math.floor((n % 1_000_000_000) / 1_000_000);
  const milliers = Math.floor((n % 1_000_000) / 1_000);
  const reste = n % 1_000;
  if (milliards > 0) parts.push(`${under1000(milliards)} ${milliards > 1 ? 'milliards' : 'milliard'}`);
  if (millions > 0) parts.push(`${under1000(millions)} ${millions > 1 ? 'millions' : 'million'}`);
  if (milliers > 0) parts.push(`${under1000(milliers).replace(/s$/, '')} mille`);
  if (reste > 0) parts.push(under1000(reste));
  return parts.join(' ');
}

// ─── Template geometry (mm from the top-left of the scanned bulletin) ────────
// Calibrated against the paper bulletin raster (201.5 × 207.7 mm page).
// Cell borders and label positions were located by pixel scans of the
// printed grid — the same discipline as the employee fiche.

/** MOIS DE / DU / AU rows inside the period box (top-right of the template). */
const PERIOD_ROWS = [
  { baseline: 28.7 }, // MOIS DE :
  { baseline: 34.7 }, // DU :
  { baseline: 40.1 }, // AU :
];
const PERIOD_VALUE_X = 134;

/** Identity grid: 4 rows × 2 columns (label ends measured on the raster). */
const GRID_LEFT_X = [27.5, 32, 33.5, 40]; // Nom / Prénom / Fonction / Date d'entrée
const GRID_RIGHT_X = [129.5, 126.5, 142.5, 134.5]; // Catégorie / N°INPS / Situation / Nbre Enfants
const GRID_BASELINES = [59.4, 64.6, 70.6, 76.6];

/** Earnings & deductions table: 10 rows, baselines on the printed grid lines. */
const TABLE_MONTANT_X = 190.2; // right-aligned inside the MONTANT column
const TABLE_BASELINES = [93.8, 99.7, 105.6, 111.4, 117.1, 123.7, 129.2, 135.0, 140.3, 146.3];

/** "Montant en toutes lettres" — writing line below the label. */
const LETTERS = { x: 52, baseline: 158.2, line2Baseline: 164 };

/** Mode de Paiement / N°Compte box (single row, two columns). */
const PAYMENT = { leftX: 46, rightX: 140, baseline: 168.2 };

/**
 * Signature block — the school cachet centered ON the printed L'EMPLOYEUR
 * signature line, the same "centered on the printed line" discipline as the
 * fiche's date. Pixel-calibrated against the template raster (16 px/mm):
 *
 *   • printed L'EMPLOYEUR line: y 198.19–198.63 mm (center 198.41),
 *     x 152.19–192.19 mm (center 172.19); the label above it shares that
 *     center — so the seal is centered on (172.19, 198.41);
 *   • the template MediaBox origin is x = 13.06 pt = 4.607 mm while mmToPdfX
 *     is anchored to 0, so every x constant here prints 4.607 mm left of its
 *     nominal value (the data columns above are calibrated in this same
 *     shifted space);
 *   • tampon.png ink bbox inside the 20 mm box: x 13 %–86 %, y 0 %–74.7 %
 *     (ink center 0.1 mm left of and 2.53 mm above the box center).
 *
 * Box center (cx, cy) ⇒ ink center (cx − 4.607 − 0.1, cy − 2.53). Targeting
 * the line center gives cx = 172.19 + 4.707 = 176.9 and cy = 198.41 + 2.53 =
 * 200.94: the ink straddles the line symmetrically (7.47 mm each side) and
 * its bottom (205.88 mm) clears the page bottom (207.75 mm). The seal PNG has
 * a transparent background, so the line shows through around the ink instead
 * of being erased by the (former) opaque white box.
 */
const STAMP_CX = 176.9;
const STAMP_CY = 200.94;
const STAMP_DIAMETER = 20;

const PT_PER_MM = 72 / 25.4;

/** Inks that read like typed entries on the paper form. */
const INK = { r: 0.09, g: 0.12, b: 0.2 }; // near-black slate
const WHITE = { r: 1, g: 1, b: 1 };

interface PtFont {
  font: import('pdf-lib').PDFFont;
  size: number;
}

export interface AdminBulletinOptions {
  staffMember: Staff;
  lang?: 'en' | 'fr';
  /**
   * Uploaded school logo (data URL). The bulletin template already carries
   * the school emblem printed in its header, so this is accepted for API
   * compatibility but not stamped — the template design is kept untouched.
   */
  schoolLogo?: string | null;
  /**
   * Override for the official paper template bytes (tests inject the file
   * directly). Defaults to fetching `/templates/bulletin-paie-mensuelle.pdf`.
   */
  template?: Uint8Array | ArrayBuffer;
}

export interface GeneratedBulletin {
  bytes: Uint8Array;
  filename: string;
}

/** Template asset served from the app's public directory. */
const TEMPLATE_URL = 'templates/bulletin-paie-mensuelle.pdf';

/** Splits a full name into family name (last token) + given names. */
export function splitName(fullName: string): { lastName: string; firstName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { lastName: '—', firstName: '—' };
  if (parts.length === 1) return { lastName: parts[0]!, firstName: '—' };
  return { lastName: parts[parts.length - 1]!, firstName: parts.slice(0, -1).join(' ') };
}

async function loadTemplateBytes(template?: Uint8Array | ArrayBuffer): Promise<Uint8Array> {
  if (template) return template instanceof Uint8Array ? template : new Uint8Array(template);
  const baseUrl =
    typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL
      ? (import.meta as { env: { BASE_URL: string } }).env.BASE_URL
      : '/';
  const res = await fetch(`${baseUrl}${TEMPLATE_URL}`);
  if (!res.ok) throw new Error(`Le bulletin modèle est introuvable (HTTP ${res.status}).`);
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

/** Formats an amount like the school writes it on the bulletin. */
function fmtFcfa(value: number): string {
  return `${value.toLocaleString('fr-FR').replace(/[\u202f\u00a0]/g, ' ')} FCFA`;
}

/**
 * Generates the official monthly bulletin de paie: THE school's paper
 * bulletin with the member's current-month data stamped on it. In the
 * browser it triggers the download; the resulting bytes are always returned
 * (tests use the return value and inject the template file).
 */
export async function generateAdminBulletinPdf({
  staffMember,
  lang = 'fr',
  schoolLogo = null, // accepted for API compatibility — the template carries its own emblem
  template,
}: AdminBulletinOptions): Promise<GeneratedBulletin> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');

  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;
  const now = new Date();
  const monthIdx = now.getMonth();
  const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][monthIdx] as keyof TranslationDict;
  const monthName = String(t[monthKey]);
  const periodYear = now.getFullYear();
  const periodFrom = new Date(periodYear, monthIdx, 1);
  const periodTo = new Date(periodYear, monthIdx + 1, 0);
  const dmy = (d: Date) => d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB');

  // ── Payroll figures (rates are frozen constants — do not edit) ──
  const base = staffMember.salary;
  const travel = staffMember.travelAllowance ?? 0;
  const communication = staffMember.communicationAllowance ?? 0;
  const housing = staffMember.housingAllowance ?? 0;
  const gross = base + travel + communication + housing;
  const inps = Math.round(base * INPS_RATE);
  const amo = Math.round(base * AMO_RATE);
  const totalCotisations = inps + amo;
  const net = gross - totalCotisations;

  const { lastName, firstName } = splitName(staffMember.name);
  const dash = '—';

  const FAMILY_STATUS_KEY: Record<string, keyof TranslationDict> = {
    single: 'familySingle',
    married: 'familyMarried',
    divorced: 'familyDivorced',
    widowed: 'familyWidowed',
  };
  const familyLabel = staffMember.familyStatus
    ? String(t[FAMILY_STATUS_KEY[staffMember.familyStatus]])
    : dash;
  const hireLabel = staffMember.hireDate
    ? dmy(new Date(`${staffMember.hireDate}T00:00:00`))
    : dash;

  // Load the school's own paper bulletin — the document that is downloaded
  // IS the provided PDF, with the data printed over it.
  const templateBytes = await loadTemplateBytes(template);
  const pdf = await PDFDocument.load(templateBytes);
  const page = pdf.getPage(0);
  const helv = await pdf.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Visible page box: anchor coordinates to the TOP of the MediaBox.
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

  const valueFont: PtFont = { font: helv, size: 8 };
  const valueBold: PtFont = { font: helvBold, size: 8 };
  const periodFont: PtFont = { font: helvBold, size: 8 };

  // 1. Period box — MOIS DE / DU / AU.
  text(`${monthName} ${periodYear}`, PERIOD_VALUE_X, PERIOD_ROWS[0]!.baseline, { font: periodFont });
  text(dmy(periodFrom), PERIOD_VALUE_X, PERIOD_ROWS[1]!.baseline, { font: periodFont });
  text(dmy(periodTo), PERIOD_VALUE_X, PERIOD_ROWS[2]!.baseline, { font: periodFont });

  // 2. Identity grid — 4 rows, 2 columns.
  const gridLeft = [lastName, firstName, staffMember.position || dash, hireLabel];
  const gridRight = [dash, staffMember.inpsNumber || dash, familyLabel, staffMember.childrenCount !== undefined ? String(staffMember.childrenCount) : dash];
  for (let i = 0; i < 4; i++) {
    text(gridLeft[i]!, GRID_LEFT_X[i]!, GRID_BASELINES[i]!, { font: valueFont });
    text(gridRight[i]!, GRID_RIGHT_X[i]!, GRID_BASELINES[i]!, { font: valueFont });
  }

  // 3. Earnings & deductions table — MONTANT column only (labels + TAUX are
  //    printed on the template). Rows 9 (Salaire Net) and 10 (Net à
  //    Percevoir) sit on filled bands: white text on the dark blue one.
  const amounts = [base, travel, communication, housing, gross, inps, amo, totalCotisations, net, net];
  const emph = [false, false, false, false, true, false, false, true, true, true]; // bold rows
  const white = [false, false, false, false, false, false, false, false, true, false]; // white ink rows
  for (let i = 0; i < amounts.length; i++) {
    const str = fmtFcfa(amounts[i]!);
    const w = (emph[i] ? helvBold : helv).widthOfTextAtSize(str, 8) / PT_PER_MM;
    text(str, TABLE_MONTANT_X - w, TABLE_BASELINES[i]!, {
      font: emph[i] ? valueBold : valueFont,
      color: white[i] ? WHITE : INK,
    });
  }

  // 4. Montant en toutes lettres — on the printed writing line.
  const words = `${montantEnLettres(net)} francs CFA`;
  const wordsFont: PtFont = { font: helv, size: 8 };
  const wordsW = helv.widthOfTextAtSize(words, 8) / PT_PER_MM;
  if (LETTERS.x + wordsW <= 192) {
    text(words, LETTERS.x, LETTERS.baseline, { font: wordsFont });
  } else {
    // Long line — wrap on the second writing line below.
    const mid = Math.max(30, Math.floor(words.length * 0.6));
    text(words.slice(0, words.lastIndexOf(' ', mid)), LETTERS.x, LETTERS.baseline, { font: wordsFont });
    text(words.slice(words.lastIndexOf(' ', mid) + 1), LETTERS.x, LETTERS.line2Baseline, { font: wordsFont });
  }

  // 5. Mode de Paiement / N°Compte box.
  text(dash, PAYMENT.leftX, PAYMENT.baseline, { font: valueFont });
  text(staffMember.bankDetails || dash, PAYMENT.rightX, PAYMENT.baseline, { font: valueFont });

  // 6. School cachet over the L'EMPLOYEUR signature block.
  const stampDoc = {
    embedPng: (png: string | Uint8Array | ArrayBuffer) => pdf.embedPng(png),
    page,
    mmToPdfX,
    mmToPdfY,
  };
  await drawSchoolStamp(stampDoc, STAMP_CX, STAMP_CY, STAMP_DIAMETER);

  const bytes = await pdf.save();
  const safeName = staffMember.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const periodStamp = `${periodYear}-${String(monthIdx + 1).padStart(2, '0')}`;
  const filename = `Bulletin_Paie_${safeName}_${periodStamp}.pdf`;
  triggerBrowserDownload(bytes, filename);
  return { bytes, filename };
}