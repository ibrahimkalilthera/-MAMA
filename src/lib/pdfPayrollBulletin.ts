/**
 * Official monthly payslip (Bulletin de paie mensuelle) PDF for school
 * administration members — mirrors the school's paper bulletin template:
 * dark-blue header with the school identity, the employee details grid,
 * the LIBELLES / TAUX / MONTANT earnings & deductions table (INPS + AMO
 * employee contributions), the net salary, the amount in words, the payment
 * method / account fields and the L'EMPLOYÉ / L'EMPLOYEUR signature blocks.
 *
 * The INPS and AMO contribution rates are the legal Malian rates printed on
 * the school's official bulletin — they are frozen constants on purpose and
 * must NOT be edited (see INPS_RATE / AMO_RATE below).
 */
import { translations } from '../i18n/translations';
import type { TranslationDict } from '../i18n/translations';
import type { Staff } from './useSupabaseData';
import { drawSchoolStamp } from './pdfStamp';

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

// ─── Bulletin geometry (A4 portrait, mm) ─────────────────────────────────────

const PAGE_W = 210;
const MARGIN = 10;
const TABLE_W = 190;
const COL_LABEL = 118; // 10 → 118
const COL_RATE = 172; // 118 → 172
const COL_AMOUNT = 200; // 172 → 200

export interface AdminBulletinOptions {
  staffMember: Staff;
  lang?: 'en' | 'fr';
  /** Uploaded school logo (data URL) — drawn inside the header emblem. */
  schoolLogo?: string | null;
}

/** Splits a full name into family name (last token) + given names. */
export function splitName(fullName: string): { lastName: string; firstName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { lastName: '—', firstName: '—' };
  if (parts.length === 1) return { lastName: parts[0]!, firstName: '—' };
  return { lastName: parts[parts.length - 1]!, firstName: parts.slice(0, -1).join(' ') };
}

/**
 * Generates and triggers download of the official monthly bulletin de paie
 * for an administration member, modeled on the school's paper template.
 */
export async function generateAdminBulletinPdf({
  staffMember,
  lang = 'fr',
  schoolLogo = null,
}: AdminBulletinOptions): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const t: TranslationDict = lang === 'fr' ? translations.fr : translations.en;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  // Palette (matches the paper bulletin: deep-blue header, blue accent rows)
  const BLUE = { r: 30, g: 58, b: 138 }; // #1E3A8A header / salaire net
  const BLUE_BRIGHT = { r: 37, g: 99, b: 235 }; // #2563EB net à percevoir
  const BLUE_LIGHT = { r: 219, g: 234, b: 254 }; // #DBEAFE total brut
  const GOLD = { r: 251, g: 191, b: 36 }; // #FBBF24 "Mensuelle"
  const INK = { r: 15, g: 23, b: 42 }; // #0F172A
  const GRAY = { r: 100, g: 116, b: 139 }; // #64748B
  const PAPER = { r: 248, g: 250, b: 252 }; // #F8FAFC
  const BORDER = { r: 203, g: 213, b: 225 }; // #CBD5E1
  const WHITE = { r: 255, g: 255, b: 255 };

  const fmt = (v: number) => `${v.toLocaleString('fr-FR')} FCFA`;

  // ── Period (current month) ──
  const now = new Date();
  const monthIdx = now.getMonth();
  const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][monthIdx] as keyof TranslationDict;
  const monthName = String(t[monthKey]);
  const periodYear = now.getFullYear();
  const periodFrom = new Date(periodYear, monthIdx, 1);
  const periodTo = new Date(periodYear, monthIdx + 1, 0);
  const dmy = (d: Date) => d.toLocaleDateString('fr-FR');

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

  // Family status code → translated label (form stores the code, PDF prints
  // the school's language).
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

  // 1. Header band
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.rect(0, 0, PAGE_W, 26, 'F');

  // Emblem: white disc, uploaded logo inside when available
  doc.setFillColor(WHITE.r, WHITE.g, WHITE.b);
  doc.circle(17, 13, 8.5, 'F');
  if (schoolLogo) {
    try {
      doc.addImage(schoolLogo, schoolLogo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 9.5, 5.5, 15, 15);
    } catch {
      // a broken logo must never break the payslip
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(BLUE.r, BLUE.g, BLUE.b);
    doc.text('M.T.', 17, 14.5, { align: 'center' });
  }
  doc.setDrawColor(WHITE.r, WHITE.g, WHITE.b);
  doc.circle(17, 13, 8.5, 'S');

  // School identity (left of the header)
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(t.title, 32, 10.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(226, 232, 240);
  doc.text(t.pdfBulletinSchoolName2, 32, 16);
  doc.text(t.pdfBulletinSchoolAddress, 32, 20.5);

  // Title (right of the header)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text(t.pdfBulletinTitle, 200, 10.5, { align: 'right' });
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(12);
  doc.setTextColor(GOLD.r, GOLD.g, GOLD.b);
  doc.text(t.pdfBulletinMonthly, 200, 17.5, { align: 'right' });

  // 2. Period box (MOIS DE / DU / AU)
  doc.setFillColor(WHITE.r, WHITE.g, WHITE.b);
  doc.setDrawColor(BLUE_BRIGHT.r, BLUE_BRIGHT.g, BLUE_BRIGHT.b);
  doc.roundedRect(132, 30, 68, 20, 2, 2, 'FD');
  doc.setTextColor(INK.r, INK.g, INK.b);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`${t.pdfBulletinMonth} : ${monthName} ${periodYear}`, 138, 37);
  doc.setFont('helvetica', 'normal');
  doc.text(`${t.pdfBulletinFrom} : ${dmy(periodFrom)}    ${t.pdfBulletinTo} : ${dmy(periodTo)}`, 138, 44);

  // 3. Employee details grid (Nom/Prénom/Fonction/Date d'entrée | Catégorie/N° INPS/Situation/Nbre enfants)
  const gridTop = 58;
  doc.setFillColor(PAPER.r, PAPER.g, PAPER.b);
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.roundedRect(MARGIN, gridTop, TABLE_W, 34, 2, 2, 'FD');

  const field = (label: string, value: string, x: number, y: number): void => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(INK.r, INK.g, INK.b);
    doc.text(value, x + 26, y);
  };

  const rowY = (i: number) => gridTop + 9 + i * 8.5;
  field(t.pdfBulletinLastName, lastName, 16, rowY(0));
  field(t.pdfBulletinFirstName, firstName, 16, rowY(1));
  field(t.pdfPosition, staffMember.position || dash, 16, rowY(2));
  field(t.pdfBulletinEntryDate, hireLabel, 16, rowY(3));

  field(t.pdfBulletinCategory, dash, 112, rowY(0));
  field(t.pdfBulletinInpsNumber, staffMember.inpsNumber || dash, 112, rowY(1));
  field(t.pdfBulletinFamilyStatus, familyLabel, 112, rowY(2));
  field(t.pdfBulletinChildrenCount, staffMember.childrenCount !== undefined ? String(staffMember.childrenCount) : dash, 112, rowY(3));

  // 4. Earnings & deductions table
  const headerTop = gridTop + 34 + 6;
  const rowH = 8;
  const rows: Array<{
    label: string;
    taux?: string;
    montant: string;
    fill?: { r: number; g: number; b: number };
    bold?: boolean;
    white?: boolean;
  }> = [
    { label: t.pdfBulletinBaseSalary, montant: fmt(base) },
    { label: t.pdfBulletinTravelAllowance, montant: fmt(travel) },
    { label: t.pdfBulletinCommunicationAllowance, montant: fmt(communication) },
    { label: t.pdfBulletinHousingAllowance, montant: fmt(housing) },
    { label: t.pdfBulletinGrossTotal, montant: fmt(gross), fill: BLUE_LIGHT, bold: true },
    { label: t.pdfBulletinInpsContribution.replace('{rate}', formatRate(INPS_RATE)), taux: formatRate(INPS_RATE), montant: fmt(inps) },
    { label: t.pdfBulletinAmoContribution.replace('{rate}', formatRate(AMO_RATE)), taux: formatRate(AMO_RATE), montant: fmt(amo) },
    { label: t.pdfBulletinTotalContributions, montant: fmt(totalCotisations), bold: true },
    { label: t.pdfBulletinNetSalary, montant: fmt(net), fill: BLUE, bold: true, white: true },
    { label: t.pdfBulletinNetToReceive, montant: fmt(net), fill: BLUE_BRIGHT, bold: true, white: true },
  ];

  // Header row
  doc.setFillColor(BLUE.r, BLUE.g, BLUE.b);
  doc.rect(MARGIN, headerTop, TABLE_W, rowH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(WHITE.r, WHITE.g, WHITE.b);
  doc.text(t.pdfBulletinLabelsHeader, 14, headerTop + 5.5);
  doc.text(t.pdfBulletinRateHeader, 145, headerTop + 5.5, { align: 'center' });
  doc.text(t.pdfBulletinAmountHeader, 196, headerTop + 5.5, { align: 'right' });

  // Data rows
  let y = headerTop + rowH;
  for (const row of rows) {
    doc.setFillColor(row.fill ? row.fill.r : WHITE.r, row.fill ? row.fill.g : WHITE.g, row.fill ? row.fill.b : WHITE.b);
    doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
    doc.rect(MARGIN, y, TABLE_W, rowH, 'FD');
    doc.setFont('helvetica', row.bold ? 'bold' : 'normal');
    doc.setFontSize(8);
    doc.setTextColor(row.white ? WHITE.r : INK.r, row.white ? WHITE.g : INK.g, row.white ? WHITE.b : INK.b);
    doc.text(row.label, 14, y + 5.5);
    if (row.taux) doc.text(row.taux, 145, y + 5.5, { align: 'center' });
    doc.text(row.montant, 196, y + 5.5, { align: 'right' });
    y += rowH;
  }
  // Column separators
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.line(COL_LABEL, headerTop, COL_LABEL, y);
  doc.line(COL_RATE, headerTop, COL_RATE, y);

  // 5. Montant en toutes lettres (wrapped — a long line must never overflow)
  const wordsText = `${t.pdfBulletinAmountInWords} : ${montantEnLettres(net)} francs CFA`;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(INK.r, INK.g, INK.b);
  let wy = y + 10;
  const maxChars = 96;
  let rest = wordsText;
  do {
    const chunk = rest.length > maxChars ? rest.slice(0, rest.lastIndexOf(' ', maxChars)) : rest;
    doc.text(chunk, MARGIN, wy);
    rest = rest.slice(chunk.length).trimStart();
    wy += 6;
  } while (rest.length > 0);

  // 6. Payment method & account
  const payTop = wy + 6;
  doc.setFillColor(PAPER.r, PAPER.g, PAPER.b);
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.roundedRect(MARGIN, payTop, 92, 13, 2, 2, 'FD');
  doc.roundedRect(108, payTop, 92, 13, 2, 2, 'FD');
  field(t.pdfBulletinPaymentMethod, dash, 16, payTop + 8.5);
  field(t.pdfBulletinAccountNumber, staffMember.bankDetails || dash, 114, payTop + 8.5);

  // 7. Signature blocks (employee left, employer right with the school cachet)
  const sigTop = payTop + 13 + 8;
  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.setLineDashPattern([1, 1], 0);
  doc.roundedRect(MARGIN, sigTop, 92, 24, 1, 1, 'D');
  doc.roundedRect(108, sigTop, 92, 24, 1, 1, 'D');
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
  doc.text(t.pdfBulletinEmployeeSig, 56, sigTop + 7, { align: 'center' });
  doc.text(t.pdfBulletinEmployerSig, 154, sigTop + 7, { align: 'center' });

  doc.setDrawColor(BORDER.r, BORDER.g, BORDER.b);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(20, sigTop + 17, 92, sigTop + 17);
  doc.line(118, sigTop + 17, 190, sigTop + 17);
  doc.setLineDashPattern([], 0);

  await drawSchoolStamp(doc, 154, sigTop + 13, 20);

  // 8. Footer
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(7);
  doc.setTextColor(GRAY.r, GRAY.g, GRAY.b);
  doc.text(t.pdfPayslipFooter, 105, 289, { align: 'center' });

  const safeName = staffMember.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const periodStamp = `${periodYear}-${String(monthIdx + 1).padStart(2, '0')}`;
  doc.save(`Bulletin_Paie_${safeName}_${periodStamp}.pdf`);
}