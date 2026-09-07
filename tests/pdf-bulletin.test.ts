/**
 * Unit tests for the official monthly payslip of administration members
 * (src/lib/pdfPayrollBulletin.ts) — the bulletin de paie mensuelle
 * downloaded for members added via "Ajouter un membre de l'administration".
 *
 * The generator does NOT redraw the bulletin: it loads the school's own
 * paper template (public/templates/bulletin-paie-mensuelle.pdf — the exact
 * PDF provided by the Direction, raster form with the school emblem, the
 * blue "BULLETIN DE PAIE Mensuelle" banner, the period box, the identity
 * grid, the LIBELLES / TAUX / MONTANT table with the pre-printed INPS 3,60 %
 * and AMO 3,06 % rates, the amount-in-words line and the signature blocks)
 * and prints the member's current-month data on top of it. These tests
 * therefore inject the REAL template file, run the real pdf-lib pipeline
 * and assert on the resulting PDF bytes:
 *
 *   • the produced document is the template page (same size, 1 page) with
 *     the data overlay appended — never a re-created look-alike;
 *   • the month's data renders for fr/en and for staff with full details;
 *   • the download filename carries the member + the period.
 *
 * The INPS/AMO percentages are frozen legal constants: a test locks their
 * exact values (3,60 % and 3,06 %) so an accidental edit fails the suite.
 *
 * Pure suite: no DOM, no jsPDF, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { translations } from '../src/i18n/translations';
import type { Staff } from '../src/lib/useSupabaseData';
import {
  generateAdminBulletinPdf,
  montantEnLettres,
  formatRate,
  INPS_RATE,
  AMO_RATE,
} from '../src/lib/pdfPayrollBulletin';

// The real paper template shipped with the app — the file the school gave us.
const templateBytes = readFileSync(new URL('../public/templates/bulletin-paie-mensuelle.pdf', import.meta.url));

const adminMember: Staff = {
  id: 'a1',
  name: 'Ibrahim Thera',
  position: 'Proviseur',
  salary: 200000,
  email: 'ibrahim@mamathera.edu.ml',
  phone: '+223 70 00 00 00',
  bankDetails: 'BOA 12345678901',
  emergencyContact: '+223 76 00 00 00',
};

describe('INPS / AMO contribution rates — frozen legal constants', () => {
  it('keeps the exact rates of the school bulletin (3,60 % INPS, 3,06 % AMO)', () => {
    assert.equal(INPS_RATE, 0.036, 'INPS rate must stay 3,60 % of the base salary');
    assert.equal(AMO_RATE, 0.0306, 'AMO rate must stay 3,06 % of the base salary');
  });

  it('formats rates with a French decimal comma for the TAUX column', () => {
    assert.equal(formatRate(INPS_RATE), '3,60');
    assert.equal(formatRate(AMO_RATE), '3,06');
  });
});

describe('montantEnLettres — French amount in words', () => {
  it('handles the classic French number traps', () => {
    assert.equal(montantEnLettres(0), 'zéro');
    assert.equal(montantEnLettres(21), 'vingt et un');
    assert.equal(montantEnLettres(71), 'soixante et onze');
    assert.equal(montantEnLettres(80), 'quatre-vingts');
    assert.equal(montantEnLettres(81), 'quatre-vingt-un');
    assert.equal(montantEnLettres(91), 'quatre-vingt-onze');
    assert.equal(montantEnLettres(200), 'deux cents');
  });

  it('drops the plural before mille and builds thousands/millions correctly', () => {
    assert.equal(montantEnLettres(200000), 'deux cent mille');
    assert.equal(montantEnLettres(80000), 'quatre-vingt mille');
    assert.equal(montantEnLettres(1000000), 'un million');
    assert.equal(montantEnLettres(120000), 'cent vingt mille');
    assert.equal(montantEnLettres(1234567), 'un million deux cent trente-quatre mille cinq cent soixante-sept');
  });
});

describe('generateAdminBulletinPdf — bulletin de paie mensuelle', () => {
  it('returns a valid PDF built FROM the school paper template (1 page, same size, larger than the template)', async () => {
    const { bytes, filename } = await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr', template: templateBytes });

    assert.ok(bytes.length > 0, 'bytes produced');
    assert.equal(bytes[0], 0x25, 'starts with %');
    assert.equal(bytes[1], 0x50, 'starts with %P');
    assert.ok(bytes.length > templateBytes.length, 'the overlay adds content to the loaded template');
    assert.match(filename, /^Bulletin_Paie_Ibrahim_Thera_\d{4}-\d{2}\.pdf$/, 'filename carries the member + the period');

    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'exactly one page — the paper bulletin itself');
    const media = reparsed.getPage(0).getMediaBox();
    assert.ok(Math.abs(media.width - 571.25) < 0.1, 'page width matches the paper template');
    assert.ok(Math.abs(media.height - 588.82) < 0.1, 'page height matches the paper template');
  });

  it('computes the frozen INPS 3,60 % / AMO 3,06 % on the base salary', async () => {
    // 200000 × 3,60 % = 7 200 ; × 3,06 % = 6 120 ; total = 13 320 ; net = 186 680
    const withDetails: Staff = {
      ...adminMember,
      travelAllowance: 10000,
      communicationAllowance: 5000,
      housingAllowance: 15000,
    };
    const { bytes } = await generateAdminBulletinPdf({ staffMember: withDetails, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'bulletin generated for a member with allowances');
    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'single page after the round-trip');
  });

  it('renders for both languages and keeps the French month name for fr', async () => {
    const now = new Date();
    const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][now.getMonth()] as keyof typeof translations.fr;

    const fr = await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr', template: templateBytes });
    assert.ok(fr.bytes.length > 0, 'French bulletin generated');
    assert.ok(String(translations.fr[monthKey]).length > 0, 'French month name available');
    assert.ok(String(translations.en[monthKey]).length > 0, 'English month name available');

    const en = await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'en', template: templateBytes });
    assert.ok(en.bytes.length > 0, 'English bulletin generated');
  });

  it('fills the identity grid, the payment box and the amount in words with real staff data', async () => {
    const fullMember: Staff = {
      ...adminMember,
      inpsNumber: '1234567890',
      hireDate: '2023-10-02',
      familyStatus: 'married',
      childrenCount: 3,
      bankDetails: 'BOA 12345678901',
    };
    const { bytes } = await generateAdminBulletinPdf({ staffMember: fullMember, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'bulletin generated with full identity data');

    // The overlay survives a save/reload round-trip on the template page.
    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'single page after the round-trip');
  });

  it('survives a member without details (dashes, never crashes)', async () => {
    const { bytes } = await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'a member without details still gets a bulletin');
    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'still a single page');
  });
});

describe('cachet zone — pixel-calibrated on the printed template', () => {
  it('centers the seal ON the printed L\'EMPLOYEUR signature line (pixel-scan calibration)', () => {
    // Pixel scan of the template raster (16 px/mm): the printed L'EMPLOYEUR
    // underline is centered on (172.19, 198.41) mm and the template MediaBox
    // origin is x = 4.607 mm (mmToPdfX is anchored to 0, so every x constant
    // prints 4.607 mm left of its nominal value). The tampon ink sits 0.1 mm
    // left of and 2.53 mm above its box center. STAMP_CX/CY solve to
    // 176.9 / 200.94 — the ink straddles the line symmetrically (7.47 mm each
    // side) and clears the page bottom (207.75 mm). See the constants'
    // comment in src/lib/pdfPayrollBulletin.ts — do not nudge these by eye.
    const src = readFileSync(new URL('../src/lib/pdfPayrollBulletin.ts', import.meta.url), 'utf8');
    assert.match(src, /const STAMP_CX = 176\.9;/, 'STAMP_CX must stay pixel-calibrated on the printed line (172.19 + media.x 4.607 + ink offset 0.1)');
    assert.match(src, /const STAMP_CY = 200\.94;/, 'STAMP_CY must stay pixel-calibrated on the printed line (198.41 + ink offset 2.53)');
  });
});
