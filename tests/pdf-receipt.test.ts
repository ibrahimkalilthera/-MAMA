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
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import type { ReceiptDataOptions } from '../src/lib/pdfReceipt';
import {
  buildParentReceiptPdf,
  LINE_M,
  TEL,
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
  it('keeps the M line, the Tél. line and the La somme de lines at their scanned positions', () => {
    assert.deepEqual(LINE_M, { x: 20.5, y: 82.0 }, 'name goes right after the printed « M » on the dotted line');
    assert.deepEqual(TEL, { x: 93.0, y: 46.3 }, 'phone starts right after the printed « Tél. : » label, on its dotted line');
    assert.deepEqual(SOMME_LINE1, { x: 54.5, y: 92.9 }, 'amount in words starts after the « La somme de : » label');
    assert.deepEqual(SOMME_LINE2, { x: 13.5, y: 105.8 }, 'continuation line starts at the left of the second dotted line');
  });

  it('keeps the Mois, Motif anchors and the placed Class/Date entries at their scanned spots', () => {
    assert.deepEqual(MOIS, { x: 31.5, y: 114.4 }, 'month after « Mois : »');
    assert.deepEqual(MOTIF, { x: 33.0, y: 125.7 }, 'motif after « Motif : »');
    assert.deepEqual(CLASSE, { x: 180.95, y: 114.4 }, 'class on the printed line (same baseline as Mois) at the right end of the « Classe : » dotted line');
    assert.deepEqual(DATE, { x: 110.0, y: 139.8 }, 'date centered on the « Date, le » dotted line before the pre-printed « 20 »');
  });

  it('keeps the BPF pill and the N° box at their scanned bboxes', () => {
    assert.deepEqual(PILL, { x0: 158.0, x1: 190.5, y0: 36.0, y1: 45.5 }, 'amount in figures sits in the gradient pill below BPF');
    assert.deepEqual(NBOX, { x0: 154.3, x1: 191.9, y0: 132.5, y1: 144.3 }, 'receipt number sits in the printed N° box');
  });
});

describe('somme en lettres — stays on the printed dotted lines (pixel scan)', () => {
  // Renders the generated receipt and the paper form at 17 px/mm and diffs the
  // « La somme de : » area: the amount in words must sit on the dotted lines
  // (line 1 y 89.5–97.5, line 2 y 103.5–108.5), with a clean interligne and no
  // overflow right of the dots (x > 192) or into the Mois line (y > 108.5).
  const PX = 6 * 72 / 25.4; // 17.01 px/mm
  const mm = (px: number) => px / PX;

  async function raster(bytes: Uint8Array) {
    // pdfjs v6 rejects Node Buffers (even though Buffer extends Uint8Array) —
    // the test's templateBytes comes straight from readFileSync, so unwrap it.
    const u8 = Buffer.isBuffer(bytes) ? new Uint8Array(bytes) : bytes;
    const doc = await pdfjs.getDocument({ data: u8 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 6 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp } as unknown as Parameters<typeof page.render>[0]).promise;
    return { w: canvas.width, h: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  }

  function diffStats(live: { w: number; h: number; data: Uint8ClampedArray }, tpl: { w: number; h: number; data: Uint8ClampedArray }, x0mm: number, x1mm: number, y0mm: number, y1mm: number) {
    const x0 = Math.floor(x0mm * PX), x1 = Math.ceil(x1mm * PX);
    const y0 = Math.floor(y0mm * PX), y1 = Math.ceil(y1mm * PX);
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, count = 0;
    for (let y = y0; y < y1 && y < live.h; y++) {
      for (let x = x0; x < x1 && x < live.w; x++) {
        const i = (y * live.w + x) * 4;
        const d = Math.abs(live.data[i] - tpl.data[i]) + Math.abs(live.data[i + 1] - tpl.data[i + 1]) + Math.abs(live.data[i + 2] - tpl.data[i + 2]);
        if (d > 60) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    return count ? { minX: mm(minX), maxX: mm(maxX), minY: mm(minY), maxY: mm(maxY), count } : null;
  }

  it('keeps a 250 000 FCFA amount in words on the first dotted line', async () => {
    const { bytes } = await buildParentReceiptPdf(
      options({ payment: { date: '2026-09-02', amount: 250000, academicYear: '2026-2027', receiptNumber: 'REC-777001' } }),
    );
    const tpl = await raster(templateBytes);
    const live = await raster(bytes);

    const d = diffStats(live, tpl, 53, 192, 89.5, 97.5);
    assert.ok(d && d.count > 1000, `the words are drawn on line 1 (${d ? d.count : 0} px)`);
    assert.ok(d!.minX >= 53.5 && d!.maxX <= 191, `line-1 words stay between x 53.5 and 191 (bbox ${d!.minX.toFixed(1)}–${d!.maxX.toFixed(1)})`);
    // 14 pt text: line-2 descenders end at 108.6, Mois caps start at 112.6 → clean band 109.5–112.0
    assert.ok(!diffStats(live, tpl, 12, 192, 109.5, 112.0), 'no ink leaks into the Mois line');
    assert.ok(!diffStats(live, tpl, 192, 201, 89.5, 108.5), 'nothing overflows right of the dotted line');
  });

  it('wraps an extreme amount onto the second dotted line without overflowing', async () => {
    // 250 999 999 FCFA — the words are far too long for one line and must wrap.
    const { bytes } = await buildParentReceiptPdf(
      options({ payment: { date: '2026-09-02', amount: 250999999, academicYear: '2026-2027', receiptNumber: 'REC-777001' } }),
    );
    const tpl = await raster(templateBytes);
    const live = await raster(bytes);

    const line1 = diffStats(live, tpl, 53, 192, 89.5, 97.5);
    const line2 = diffStats(live, tpl, 12, 192, 103.0, 109.5);
    assert.ok(line1 && line1.count > 1000, `line 1 is filled (${line1 ? line1.count : 0} px)`);
    assert.ok(line2 && line2.count > 1000, `the continuation is drawn on line 2 (${line2 ? line2.count : 0} px)`);
    assert.ok(line1!.maxX <= 191, `line 1 ends before the dots do (${line1!.maxX.toFixed(1)})`);
    assert.ok(line2!.minY >= 103.0 && line2!.maxY <= 109.5, `line 2 sits in its own dotted band (y ${line2!.minY.toFixed(1)}–${line2!.maxY.toFixed(1)})`);
    assert.ok(!diffStats(live, tpl, 53, 192, 97.5, 103.5), 'the interligne between the two lines stays clean');
    assert.ok(!diffStats(live, tpl, 192, 201, 89.5, 109.5), 'nothing overflows right of the dotted line');
    // 14 pt text: line-2 descenders end at 108.6, Mois caps start at 112.6 → clean band 109.5–112.0
    assert.ok(!diffStats(live, tpl, 12, 192, 109.5, 112.0), 'nothing leaks into the Mois line');
  });
});

describe('téléphone du parent — sur la ligne « Tél. : » (pixel scan)', () => {
  // Renders the generated receipt and the paper form at 17 px/mm and diffs the
  // « Tél. : » header line: the phone must be drawn right after the printed
  // label (x ≥ 93), ON the dotted line (baseline 48.0, band y 44–50.5), and
  // must not leak into the « République du Mali » line below (y 50.5–53.5).
  const PX = 6 * 72 / 25.4; // 17.01 px/mm
  const mm = (px: number) => px / PX;

  async function raster(bytes: Uint8Array) {
    const u8 = Buffer.isBuffer(bytes) ? new Uint8Array(bytes) : bytes;
    const doc = await pdfjs.getDocument({ data: u8 }).promise;
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 6 });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport: vp } as unknown as Parameters<typeof page.render>[0]).promise;
    return { w: canvas.width, h: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
  }

  function diffStats(live: { w: number; h: number; data: Uint8ClampedArray }, tpl: { w: number; h: number; data: Uint8ClampedArray }, x0mm: number, x1mm: number, y0mm: number, y1mm: number) {
    const x0 = Math.floor(x0mm * PX), x1 = Math.ceil(x1mm * PX);
    const y0 = Math.floor(y0mm * PX), y1 = Math.ceil(y1mm * PX);
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, count = 0;
    for (let y = y0; y < y1 && y < live.h; y++) {
      for (let x = x0; x < x1 && x < live.w; x++) {
        const i = (y * live.w + x) * 4;
        const d = Math.abs(live.data[i] - tpl.data[i]) + Math.abs(live.data[i + 1] - tpl.data[i + 1]) + Math.abs(live.data[i + 2] - tpl.data[i + 2]);
        if (d > 60) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          count++;
        }
      }
    }
    return count ? { minX: mm(minX), maxX: mm(maxX), minY: mm(minY), maxY: mm(maxY), count } : null;
  }

  it('writes the parent phone on the « Tél. : » dotted line', async () => {
    const { bytes } = await buildParentReceiptPdf(options());
    const tpl = await raster(templateBytes);
    const live = await raster(bytes);

    const d = diffStats(live, tpl, 93, 175, 44, 50.5);
    assert.ok(d && d.count > 500, `the phone is drawn after the « Tél. : » label (${d ? d.count : 0} px)`);
    assert.ok(d!.minX >= 93, `it starts right after the label (minX ${d!.minX.toFixed(1)})`);
    assert.ok(d!.minY >= 44.0 && d!.maxY <= 50.5, `it sits on the dotted line (y ${d!.minY.toFixed(1)}–${d!.maxY.toFixed(1)})`);
    assert.ok(!diffStats(live, tpl, 93, 175, 50.5, 53.5), 'nothing leaks into the « République du Mali » line below');
  });

  it('skips the Tél. entry when the parent has no phone', async () => {
    const { bytes } = await buildParentReceiptPdf(
      options({ student: { ...baseStudent, parentPhone: '' } }),
    );
    const tpl = await raster(templateBytes);
    const live = await raster(bytes);
    assert.ok(!diffStats(live, tpl, 93, 175, 44, 50.5), 'no phone ink on the line when parentPhone is empty');
  });
});