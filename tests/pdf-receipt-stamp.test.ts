/**
 * Unit tests for the parent payment receipt PDF (src/lib/pdfReceipt.ts).
 *
 * Runs jsPDF-free on purpose: the `jspdf` module is mocked at the module
 * level (node:test --experimental-test-module-mocks) by a FakeJsPDF that
 * records every drawing call, so the REAL receipt layout code executes and
 * can be asserted. The stamp module (`../src/lib/pdfStamp`) is mocked by a
 * recording spy — the stamp's own fetch/decode path is environment-bound
 * (browser fetch + canvas) and not what is under test here; what matters is
 * that the receipt draws the stamp exactly once, centered in its "cachet"
 * box, with the documented geometry (cx = 39.5 mm, diameter = 20 mm).
 *
 * Pure suite: no happy-dom globals — the receipt code touches nothing
 * outside jsPDF once the two modules are mocked.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { ReceiptDataOptions } from '../src/lib/pdfReceipt';

// ── module mocks (registered BEFORE importing the module under test) ────────

// Fake jsPDF: records rect/roundedRect geometry and save() filenames.
const pdfRects: unknown[][] = [];
const pdfSaves: string[] = [];
const pdfDocs: unknown[] = [];
class FakeJsPDF {
  constructor() {
    pdfDocs.push(this);
  }
  setFillColor() {}
  setDrawColor() {}
  setTextColor() {}
  setFont() {}
  setFontSize() {}
  setLineDashPattern() {}
  text() {}
  rect(...args: unknown[]) {
    pdfRects.push(args);
  }
  roundedRect(...args: unknown[]) {
    pdfRects.push(args);
  }
  save(fileName: string) {
    pdfSaves.push(fileName);
  }
}

mock.module('jspdf', {
  namedExports: { jsPDF: FakeJsPDF },
});

// Recording spy for the school stamp: captures (doc, cx, cy, diameterMm).
// `stampActive` lets a test simulate the stamp image being unavailable
// (pdfStamp's non-blocking contract: it resolves without drawing).
interface StampCall {
  doc: unknown;
  cx: number;
  cy: number;
  diameterMm: number;
}
const stampCalls: StampCall[] = [];
let stampActive = true;
mock.module('../src/lib/pdfStamp', {
  namedExports: {
    drawSchoolStamp: async (doc: unknown, cx: number, cy: number, diameterMm: number): Promise<void> => {
      if (stampActive) stampCalls.push({ doc, cx, cy, diameterMm });
    },
  },
});

const { generatePaymentReceiptPdf } = await import('../src/lib/pdfReceipt');

// ── fixtures ─────────────────────────────────────────────────────────────────

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
    ...overrides,
  };
}

/** Find the cachet-box roundedRect: (12, y, 55, 22, 1, 1, 'D'). */
function findStampBox(): { x: number; y: number; w: number; h: number } | null {
  for (const args of pdfRects) {
    if (args[0] === 12 && args[2] === 55 && args[3] === 22 && args[6] === 'D') {
      return { x: args[0] as number, y: args[1] as number, w: args[2] as number, h: args[3] as number };
    }
  }
  return null;
}

describe('generatePaymentReceiptPdf — school stamp placement', () => {
  it('draws the stamp exactly once, centered in the cachet box at the documented coordinates', async () => {
    stampCalls.length = 0;
    pdfRects.length = 0;
    pdfSaves.length = 0;
    pdfDocs.length = 0;

    await generatePaymentReceiptPdf(options());

    // the emerald header bar is still drawn
    assert.ok(
      pdfRects.some((r) => r[0] === 0 && r[1] === 0 && r[2] === 148 && r[3] === 22 && r[4] === 'F'),
      'the full-width emerald header bar is drawn first',
    );

    // the cachet box (left signature/stamp box) exists on the receipt
    const box = findStampBox();
    assert.ok(box, 'the 55×22 mm cachet box is drawn');
    assert.equal(box.w, 55);
    assert.equal(box.h, 22);

    // stamp drawn exactly once, centered on the box with the documented geometry
    assert.equal(stampCalls.length, 1, 'the school stamp is drawn exactly once');
    const stamp = stampCalls[0]!;
    assert.equal(pdfDocs.length, 1, 'one document instance is built');
    assert.equal(stamp.doc, pdfDocs[0], 'the stamp is drawn on the same document');
    assert.equal(stamp.cx, 39.5, 'stamp center x = 39.5 mm (middle of the 12→67 mm box)');
    assert.equal(stamp.cy, box.y + 11, 'stamp center y = box top + 11 mm (middle of the 22 mm box)');
    assert.equal(stamp.diameterMm, 20, 'stamp diameter = 20 mm');

    // geometry sanity: the 20 mm stamp fits inside the 55×22 mm box
    assert.ok(stamp.cx - stamp.diameterMm / 2 >= box.x, 'stamp left edge stays inside the box');
    assert.ok(stamp.cx + stamp.diameterMm / 2 <= box.x + box.w, 'stamp right edge stays inside the box');
    assert.ok(stamp.cy - stamp.diameterMm / 2 >= box.y, 'stamp top edge stays inside the box');
    assert.ok(stamp.cy + stamp.diameterMm / 2 <= box.y + box.h, 'stamp bottom edge stays inside the box');

    // the signature box sits on the same row, right of the stamp box
    assert.ok(
      pdfRects.some((r) => r[0] === 81 && r[1] === box.y && r[2] === 55 && r[3] === 22 && r[6] === 'D'),
      'the signature box is drawn on the same baseline, to the right of the stamp',
    );

    // the document is saved under the receipt file name
    assert.equal(pdfSaves.length, 1);
    assert.equal(pdfSaves[0], 'Recu_REC-777001_Ali_Diallo.pdf');
  });

  it('still generates and saves the receipt when the stamp image is unavailable (non-blocking)', async () => {
    stampActive = false; // pdfStamp resolves without drawing — image missing
    stampCalls.length = 0;
    pdfRects.length = 0;
    pdfSaves.length = 0;
    pdfDocs.length = 0;
    try {
      await generatePaymentReceiptPdf(options());

      assert.equal(stampCalls.length, 0, 'the unavailable stamp is not drawn');
      assert.equal(pdfDocs.length, 1, 'the document is still built');
      assert.ok(pdfRects.length > 0, 'the receipt layout is still drawn');
      assert.equal(pdfSaves.length, 1, 'the document is still saved');
      assert.equal(pdfSaves[0], 'Recu_REC-777001_Ali_Diallo.pdf');
    } finally {
      stampActive = true;
    }
  });

  it('falls back to a generated REC-###### number in the file name when the payment has none', async () => {
    stampCalls.length = 0;
    pdfRects.length = 0;
    pdfSaves.length = 0;
    pdfDocs.length = 0;

    await generatePaymentReceiptPdf(options({ payment: { date: '2026-09-02', amount: 25000 } }));

    assert.equal(pdfSaves.length, 1);
    assert.match(pdfSaves[0] ?? '', /^Recu_REC-\d{6}_Ali_Diallo\.pdf$/);
  });
});
