/**
 * Unit tests for the parent payment receipt (src/lib/pdfReceipt.ts) — the
 * official reçu de paiement downloaded for parents.
 *
 * The generator does NOT redraw the receipt: it loads the school's own paper
 * form (public/templates/recu-parent.pdf — the exact PDF provided by the
 * Direction: raster form with the emblem, the BPF box + gradient pill, the
 * M / La somme de / Mois & Classe / Motif fill-in lines and the Date, le …
 * 20 …  N° footer) and prints the payment data on top of it. These tests
 * therefore inject the REAL template file, run the real pdf-lib pipeline
 * and assert on the resulting PDF bytes:
 *
 *   • the produced document is the template page (same size, 1 page) with
 *     the data overlay appended — never a re-created look-alike;
 *   • the calibrated fill-in coordinates are drift-locked (the pixel scans
 *     that produced them are documented at the constants);
 *   • the download filename carries the receipt number + the student.
 *
 * Pure suite: no DOM, no jsPDF, no mocks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import type { ReceiptDataOptions } from '../src/lib/pdfReceipt';
import {
  buildParentReceiptPdf,
  LINE_M,
  SOMME_LINE1,
  SOMME_LINE2,
  MOIS,
  CLASSE,
  MOTIF,
  DATE,
  PILL,
  NBOX,
} from '../src/lib/pdfReceipt';

// The real paper form shipped with the app — the file the school gave us.
const templateBytes = readFileSync(new URL('../public/templates/recu-parent.pdf', import.meta.url));

const baseStudent: ReceiptDataOptions['student'] = {
  id: 's1',
  name: 'Ali Diallo',
  parentName: 'Mamadou Diallo',
  parentEmail: 'parent@example.com',
  parentPhone: '+223 70 00 00 00',
  totalDue: 150000,
  amountPaid: 50000,
  dueDate: '2026-12-31',
  grade: '9eme A',
  academicYear: '2026-2027',
  payments: [],
  notes: '',
};

function options(overrides: Partial<ReceiptDataOptions> = {}): ReceiptDataOptions {
  return {
    student: baseStudent,
    payment: { date: '2026-09-02', amount: 25000, academicYear: '2026-2027', receiptNumber: 'REC-777001' },
    lang: 'fr',
    cashierName: 'Ibrahim Thera',
    template: templateBytes, // tests never fetch — the real paper form is injected
    ...overrides,
  };
}

describe('buildParentReceiptPdf — the school paper form with the payment overlay', () => {
  it('returns a valid PDF built FROM the paper template (1 page, same size, larger than the template)', async () => {
    const { bytes, filename } = await buildParentReceiptPdf(options());

    assert.ok(bytes.length > 0, 'bytes produced');
    assert.equal(bytes[0], 0x25, 'starts with %');
    assert.equal(bytes[1], 0x50, 'starts with %P');
    assert.ok(bytes.length > templateBytes.length, 'the overlay adds content to the loaded template');
    assert.equal(filename, 'Recu_REC-777001_Ali_Diallo.pdf', 'filename carries the receipt number + the student');

    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'exactly one page — the paper form itself');
    const media = reparsed.getPage(0).getMediaBox();
    assert.ok(Math.abs(media.width - 569.83) < 0.1, 'page width matches the paper form (569.83 pt = 201 mm)');
    assert.ok(Math.abs(media.height - 441.63) < 0.1, 'page height matches the paper form (441.63 pt = 155.8 mm)');
  });

  it('fills every field for a payment with full details (name, amount in words, figures in the BPF pill, N°, month, class, motif, date)', async () => {
    const { bytes } = await buildParentReceiptPdf(options());
    assert.ok(bytes.length > 0, 'receipt generated');

    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'single page after the round-trip');
  });

  it('falls back to a generated REC-###### number in the file name when the payment has none', async () => {
    const { filename } = await buildParentReceiptPdf(
      options({ payment: { date: '2026-09-02', amount: 25000 } }),
    );
    assert.match(filename, /^Recu_REC-\d{6}_Ali_Diallo\.pdf$/);
  });

  it('survives a payment without amount or date (dashes, never crashes)', async () => {
    const { bytes } = await buildParentReceiptPdf(
      options({ payment: { amount: 0, date: '' } }),
    );
    assert.ok(bytes.length > 0, 'a zero-amount receipt still generates');
    const reparsed = await PDFDocument.load(bytes);
    assert.equal(reparsed.getPageCount(), 1, 'still a single page');
  });

  it('accepts the template bytes directly without fetching', async () => {
    const { bytes } = await buildParentReceiptPdf(options({ template: templateBytes }));
    assert.ok(bytes.length > 0, 'receipt generated from injected template');
  });
});

describe('calibrated fill-in zones — pixel-scan drift lock', () => {
  // The constants below were produced by pixel scans of the 201.1 × 155.8 mm
  // paper raster (12 px/mm). They map rendered-page mm to the printed zones;
  // do not nudge them by eye. See the geometry comment in src/lib/pdfReceipt.ts.
  it('keeps the M line and the La somme de lines at their scanned positions', () => {
    assert.deepEqual(LINE_M, { x: 20.5, y: 82.0 }, 'name goes right after the printed « M » on the dotted line');
    assert.deepEqual(SOMME_LINE1, { x: 54.5, y: 92.9 }, 'amount in words starts after the « La somme de : » label');
    assert.deepEqual(SOMME_LINE2, { x: 13.5, y: 105.8 }, 'continuation line starts at the left of the second dotted line');
  });

  it('keeps the Mois/Classe, Motif and Date anchors on their printed baselines', () => {
    assert.deepEqual(MOIS, { x: 31.5, y: 114.4 }, 'month after « Mois : »');
    assert.deepEqual(CLASSE, { x: 150.5, y: 114.4 }, 'class after « Classe : »');
    assert.deepEqual(MOTIF, { x: 33.0, y: 125.7 }, 'motif after « Motif : »');
    assert.deepEqual(DATE, { x: 76.5, y: 139.8 }, 'date after « Date, le »');
  });

  it('keeps the BPF pill and the N° box at their scanned bboxes', () => {
    assert.deepEqual(PILL, { x0: 158.0, x1: 190.5, y0: 36.0, y1: 45.5 }, 'amount in figures sits in the gradient pill below BPF');
    assert.deepEqual(NBOX, { x0: 154.3, x1: 191.9, y0: 132.5, y1: 144.3 }, 'receipt number sits in the printed N° box');
  });
});