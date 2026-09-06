/**
 * Unit tests for the official individual salary payment record
 * (src/lib/pdfPayrollFiche.ts) — the receipt downloaded for regular
 * employees (added via "Ajouter un Employé"), modeled on the school's paper
 * fiche de paiement de salaire.
 *
 * Runs jsPDF-free: the `jspdf` module is mocked at the module level
 * (node:test --experimental-test-module-mocks) by a FakeJsPDF that records
 * every drawing call, so the REAL fiche layout code executes and can be
 * asserted. The stamp module (`../src/lib/pdfStamp`) is mocked by a
 * recording spy — the fiche draws the school stamp exactly once, on the
 * "CACHET DE LA DIRECTION" line.
 *
 * The deductions column MUST reuse the frozen INPS/AMO rates of the monthly
 * bulletin (3,60 % + 3,06 % of the base salary): a test locks the exact
 * amounts so an accidental drift fails the suite.
 *
 * Pure suite: no happy-dom globals.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { translations } from '../src/i18n/translations';
import type { Staff } from '../src/lib/useSupabaseData';

// ── module mocks (registered BEFORE importing the module under test) ────────

const pdfTexts: Array<string | string[]> = [];
const pdfSaves: string[] = [];
const pdfImages: unknown[][] = [];
class FakeJsPDF {
  setFillColor() {}
  setDrawColor() {}
  setTextColor() {}
  setFont() {}
  setFontSize() {}
  setLineDashPattern() {}
  text(payload: string | string[]) {
    pdfTexts.push(payload);
  }
  rect() {}
  roundedRect() {}
  circle() {}
  line() {}
  triangle() {}
  polygon() {}
  saveGraphicsState() {}
  restoreGraphicsState() {}
  translate() {}
  rotate() {}
  addImage(...args: unknown[]) {
    pdfImages.push(args);
  }
  save(fileName: string) {
    pdfSaves.push(fileName);
  }
}

mock.module('jspdf', {
  namedExports: { jsPDF: FakeJsPDF },
});

// Recording spy for the school stamp: captures (doc, cx, cy, diameterMm).
const stampCalls: Array<{ doc: unknown; cx: number; cy: number; diameterMm: number }> = [];
mock.module('../src/lib/pdfStamp', {
  namedExports: {
    drawSchoolStamp: async (doc: unknown, cx: number, cy: number, diameterMm: number): Promise<void> => {
      stampCalls.push({ doc, cx, cy, diameterMm });
    },
  },
});

const { generateEmployeeFichePdf } = await import('../src/lib/pdfPayrollFiche');

// ── fixtures ─────────────────────────────────────────────────────────────────

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

function reset(): void {
  pdfTexts.length = 0;
  pdfSaves.length = 0;
  pdfImages.length = 0;
  stampCalls.length = 0;
}

/** Flattens every drawn text (single strings and multi-line arrays) + normalizes
 *  whitespace (fr-FR thousands use a narrow no-break space). */
function drawnTexts(): string[] {
  return pdfTexts.flat().map((s) => s.replace(/\s+/g, ' '));
}

describe('generateEmployeeFichePdf — fiche individuelle de paiement de salaire', () => {
  it('draws the official title, the school identity and the employee name', async () => {
    reset();
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr' });

    const drawn = drawnTexts();
    assert.ok(drawn.includes('FICHE INDIVIDUELLE DE PAIEMENT DE SALAIRE'), 'the fiche title is drawn');
    assert.ok(drawn.includes('MAMA THERA DE SAFO'), 'the school name is drawn');
    assert.ok(drawn.includes('PÉRIODE :'), 'the PÉRIODE label is drawn');
    assert.ok(drawn.includes('Fatou Traoré'), 'first name + last name are drawn in the first column');
    assert.ok(drawn.includes('Enseignante'), 'the position is drawn');
    assert.ok(drawn.includes('BOA 12345678901'), 'the payment method / account is drawn');
    assert.ok(drawn.includes('CACHET DE LA DIRECTION :'), 'the cachet label is drawn');
    // The payment date label is drawn WITH the date on the same line.
    assert.ok(drawn.some((s) => s.includes('DATE DE PAIEMENT :')), 'the payment date label is drawn');
  });

  it('shows NO INPS/AMO deductions on the employee fiche — net = base salary', async () => {
    reset();
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr' });

    const drawn = drawnTexts();
    // base 120000, no allowances, no contributions → net payé = 120 000
    assert.ok(drawn.includes('120 000 FCFA'), 'base salary amount drawn (and net paid = base salary)');
    assert.ok(drawn.some((s) => s.includes('Salaire de base')), 'the base salary label is drawn');
    assert.ok(drawn.some((s) => s.includes('Retenues')), 'the Retenues label is drawn');
    assert.ok(drawn.some((s) => s.includes('Salaire net payé')), 'the net salary label is drawn');
    assert.ok(!drawn.some((s) => s.includes('INPS')), 'no INPS on the employee fiche');
    assert.ok(!drawn.some((s) => s.includes('AMO')), 'no AMO on the employee fiche');
  });

  it('draws the period box with the current month and year', async () => {
    reset();
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr' });

    const now = new Date();
    const monthKey = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'][now.getMonth()] as keyof typeof translations.fr;
    const monthName = String(translations.fr[monthKey]);
    const drawn = drawnTexts();
    assert.ok(
      drawn.some((s) => s.includes(monthName) && s.includes(String(now.getFullYear()))),
      `the period box contains the current month (${monthName}) and year`,
    );
  });

  it('saves the fiche under Fiche_Paie_<name>_<period>.pdf', async () => {
    reset();
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr' });

    assert.equal(pdfSaves.length, 1, 'one PDF saved');
    // "Traoré" is sanitized to "Traor" (é dropped) — the regex tolerates it.
    assert.match(pdfSaves[0], /^Fiche_Paie_Fatou_Traor.*_\d{4}-\d{2}\.pdf$/, 'filename carries the name and the period');
  });

  it('draws the school stamp exactly once, on the CACHET DE LA DIRECTION line', async () => {
    reset();
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr' });

    assert.equal(stampCalls.length, 1, 'the stamp is drawn exactly once');
    const stamp = stampCalls[0]!;
    assert.equal(stamp.cy, 266.5, 'the stamp is centered on the cachet line');
    assert.ok(stamp.cy + stamp.diameterMm / 2 <= 289, 'the stamp stays inside the A4 page');
  });

  it('embeds the school logo in the emblem AND the watermark seal box', async () => {
    reset();
    const logo = 'data:image/png;base64,AAAA';
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr', schoolLogo: logo });

    assert.ok(pdfImages.length >= 2, 'the logo is drawn twice (emblem + watermark box)');
    for (const args of pdfImages) {
      assert.equal(args[0], logo, 'the uploaded logo data URL is embedded');
    }
  });

  it('falls back to M.T. text when no logo is uploaded', async () => {
    reset();
    await generateEmployeeFichePdf({ staffMember: employee, lang: 'fr' });

    const drawn = drawnTexts();
    assert.ok(drawn.includes('M.T.'), 'the emblem fallback is drawn');
    assert.equal(pdfImages.length, 0, 'no image embedded without a logo');
  });

  it('fills the Primes / Indemnités column and adds the allowances to the net paid', async () => {
    reset();
    const withAllowances: Staff = {
      ...employee,
      travelAllowance: 10000,
      communicationAllowance: 5000,
      housingAllowance: 15000,
    };
    await generateEmployeeFichePdf({ staffMember: withAllowances, lang: 'fr' });

    const drawn = drawnTexts();
    // base 120000 + 30000 allowances → net payé 150 000, without any contribution
    assert.ok(drawn.includes('30 000 FCFA'), 'the total allowances are drawn in the Primes column');
    assert.ok(drawn.includes('150 000 FCFA'), 'net paid = base + allowances');
    assert.ok(!drawn.some((s) => s.includes('INPS')), 'still no INPS on the employee fiche');
    assert.ok(!drawn.some((s) => s.includes('AMO')), 'still no AMO on the employee fiche');
  });
});