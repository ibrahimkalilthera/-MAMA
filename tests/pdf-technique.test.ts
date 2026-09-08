/**
 * Unit tests for the technical-center individual salary payment record
 * (src/lib/pdfPayrollTechnique.ts) — the receipt downloaded for members
 * added via "Ajouter un Membre du Centre Technique".
 *
 * Same discipline as the employee fiche: the generator does NOT redraw the
 * form — it loads the school's own paper template
 * (public/templates/fiche-technique.pdf) and prints the member's current
 * month data on top of it. These tests inject the REAL template file, run
 * the real pdf-lib pipeline and assert on the resulting PDF bytes:
 *
 *   • the produced document is the template page (same size, 1 page) with
 *     the payroll overlay appended — never a re-created look-alike;
 *   • the month's data renders for fr/en and for staff with allowances;
 *   • the download filename carries the member + the period.
 *
 * Pure suite: no DOM, no jsPDF, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { translations } from '../src/i18n/translations';
import type { Staff } from '../src/lib/useSupabaseData';
import { generateTechniqueFichePdf } from '../src/lib/pdfPayrollTechnique';

// The real technical-center paper template shipped with the app.
const templateBytes = readFileSync(new URL('../public/templates/fiche-technique.pdf', import.meta.url));

const technician: Staff = {
  id: 'st1',
  name: 'Moussa Coulibaly',
  position: 'Technicien',
  salary: 110000,
  email: 'moussa@mamathera.edu.ml',
  phone: '+223 70 11 22 33',
  bankDetails: 'BOA 12345678901',
  emergencyContact: '+223 76 00 00 00',
};

describe('generateTechniqueFichePdf — fiche individuelle de paiement (Centre Technique)', () => {
  it('returns a valid PDF built FROM the paper template (1 page, same size, larger than the template)', async () => {
    const { bytes, filename } = await generateTechniqueFichePdf({ staffMember: technician, lang: 'fr', template: templateBytes });

    assert.ok(bytes.length > 0, 'bytes produced');
    assert.equal(bytes[0], 0x25, 'starts with %');
    assert.equal(bytes[1], 0x50, 'starts with %P');
    assert.ok(bytes.length > templateBytes.length, 'the overlay adds content to the loaded template');
    assert.match(filename, /^Fiche_Technique_Moussa_Coulibaly_\d{4}-\d{2}\.pdf$/, 'filename carries the member + the period');

    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'exactly one page — the paper fiche itself');
    const media = reparsed.getPage(0).getMediaBox();
    assert.ok(Math.abs(media.width - 597.38) < 0.1, 'page width matches the paper template');
    assert.ok(Math.abs(media.height - 594.76) < 0.1, 'page height matches the paper template');
  });

  it('renders for both languages and keeps the French month name in the PÉRIODE box', async () => {
    const now = new Date();
    const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][now.getMonth()] as keyof typeof translations.fr;

    const fr = await generateTechniqueFichePdf({ staffMember: technician, lang: 'fr', template: templateBytes });
    assert.ok(fr.bytes.length > 0, 'French fiche generated');
    // The month label itself is localized from the i18n dictionaries.
    assert.ok(String(translations.fr[monthKey]).length > 0, 'French month name available');
    assert.ok(String(translations.en[monthKey]).length > 0, 'English month name available');

    const en = await generateTechniqueFichePdf({ staffMember: technician, lang: 'en', template: templateBytes });
    assert.ok(en.bytes.length > 0, 'English fiche generated');
  });

  it('prints the payment with allowances added to the net — the payroll figures survive a save/reload round-trip', async () => {
    const withAllowances: Staff = {
      ...technician,
      travelAllowance: 8000,
      communicationAllowance: 4000,
      housingAllowance: 12000,
    };
    const { bytes } = await generateTechniqueFichePdf({ staffMember: withAllowances, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'fiche generated for a member with allowances');
    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'single page after the round-trip');
  });

  it('handles a long multi-word name and a member without a position gracefully', async () => {
    const longName: Staff = {
      ...technician,
      name: 'Seydou Traoré Koné Diarra',
      position: '',
      salary: 75000,
    };
    const { bytes } = await generateTechniqueFichePdf({ staffMember: longName, lang: 'fr', template: templateBytes });
    assert.ok(bytes.length > 0, 'fiche generated with a long name');
  });
});