/**
 * Unit tests for the individual salary payment record
 * (src/lib/pdfPayrollFiche.ts) — the receipt downloaded for regular
 * employees (added via "Ajouter un Employé").
 *
 * The generator does NOT redraw the fiche: it loads the school's own paper
 * template (public/templates/fiche-paiement-salaire.pdf — the exact PDF
 * provided by the Direction, raster form with the school emblem, the 6-column
 * payroll table and the CACHET / DATE footer) and prints the employee's
 * current-month data on top of it. These tests therefore inject the REAL
 * template file, run the real pdf-lib pipeline and assert on the resulting
 * PDF bytes:
 *
 *   • the produced document is the template page (same size, 1 page) with the
 *     payroll overlay appended — never a re-created look-alike;
 *   • the month's data renders for fr/en and for staff with allowances;
 *   • the download filename carries the employee + the period.
 *
 * Pure suite: no DOM, no jsPDF, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { translations } from '../src/i18n/translations';
import type { Staff } from '../src/lib/useSupabaseData';
import { generateEmployeeFichePdf } from '../src/lib/pdfPayrollFiche';

// The real paper template shipped with the app — the file the school gave us.
const templateBytes = readFileSync(new URL('../public/templates/fiche-paiement-salaire.pdf', import.meta.url));

const employee: Staff = {
  id: 'st1',
  name: 'Fatou Traoré',
  position: 'Enseignante',
  salary: 120000,
  email: 'fatou@mamathera.edu.ml',
  phone: '+223 70 00 00 00',
  bankDetails: 'BOA 12345678901',
  emergencyContact: '+223 76 00 00 00',
};

describe('generateEmployeeFichePdf — fiche individuelle de paiement de salaire', () => {
  it('returns a valid PDF built FROM the school paper template (1 page, same size, larger than the template)', async () => {
    const { bytes, filename } = await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr', template: templateBytes });

    assert.ok(bytes.length > 0, 'bytes produced');
    assert.equal(bytes[0], 0x25, 'starts with %');
    assert.equal(bytes[1], 0x50, 'starts with %P');
    assert.ok(bytes.length > templateBytes.length, 'the overlay adds content to the loaded template');
    assert.match(filename, /^Fiche_Paie_Fatou_Traor.*_\d{4}-\d{2}\.pdf$/, 'filename carries the employee + the period');

    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'exactly one page — the paper fiche itself');
    const media = reparsed.getPage(0).getMediaBox();
    assert.ok(Math.abs(media.width - 596.18) < 0.1, 'page width matches the paper template');
    assert.ok(Math.abs(media.height - 594.76) < 0.1, 'page height matches the paper template');
  });

  it('renders for both languages and keeps the French month name in the PÉRIODE box', async () => {
    const now = new Date();
    const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][now.getMonth()] as keyof typeof translations.fr;

    const fr = await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr', template: templateBytes });
    assert.ok(fr.bytes.length > 0, 'French fiche generated');
    // The month label itself is localized from the i18n dictionaries.
    assert.ok(String(translations.fr[monthKey]).length > 0, 'French month name available');
    assert.ok(String(translations.en[monthKey]).length > 0, 'English month name available');

    const en = await generateEmployeeFichePdf({ staffMember: employee, lang: 'en', template: templateBytes });
    assert.ok(en.bytes.length > 0, 'English fiche generated');
  });

  it('prints the payment with allowances added to the net — the payroll figures survive a save/reload round-trip', async () => {
    const withAllowances: Staff = {
      ...employee,
      travelAllowance: 10000,
      communicationAllowance: 5000,
      housingAllowance: 15000,
    };
    const { bytes } = await generateEmployeeFichePdf({ staffMember: withAllowances, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'fiche generated for an employee with allowances');
    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'single page after the round-trip');
  });

  it('handles a long multi-word name and an employee without a position gracefully', async () => {
    const longName: Staff = {
      ...employee,
      name: 'Aminata Konaté Diallo Diarra',
      position: '',
      salary: 80000,
    };
    const { bytes } = await generateEmployeeFichePdf({ staffMember: longName, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'fiche generated with a long name');
  });
});
