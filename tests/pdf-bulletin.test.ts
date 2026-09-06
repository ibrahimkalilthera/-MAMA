/**
 * Unit tests for the official monthly payslip of administration members
 * (src/lib/pdfPayrollBulletin.ts).
 *
 * Runs jsPDF-free: the `jspdf` module is mocked at the module level
 * (node:test --experimental-test-module-mocks) by a FakeJsPDF that records
 * every drawing call, so the REAL bulletin layout code executes and can be
 * asserted. The stamp module (`../src/lib/pdfStamp`) is mocked by a
 * recording spy — what matters here is that the bulletin draws the stamp
 * exactly once, inside the employer signature block.
 *
 * The INPS/AMO percentages are frozen legal constants: a test locks their
 * exact values (3,60 % and 3,06 %) so an accidental edit fails the suite.
 *
 * Pure suite: no happy-dom globals — the bulletin code touches nothing
 * outside jsPDF once the two modules are mocked.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Staff } from '../src/lib/useSupabaseData';

// ── module mocks (registered BEFORE importing the module under test) ────────

const pdfTexts: string[] = [];
const pdfSaves: string[] = [];
const pdfRects: unknown[][] = [];
const pdfImages: unknown[][] = [];
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
  text(payload: string) {
    pdfTexts.push(payload);
  }
  rect(...args: unknown[]) {
    pdfRects.push(args);
  }
  roundedRect(...args: unknown[]) {
    pdfRects.push(args);
  }
  circle(...args: unknown[]) {
    pdfRects.push(args);
  }
  line() {}
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

const { generateAdminBulletinPdf, montantEnLettres, formatRate, INPS_RATE, AMO_RATE } =
  await import('../src/lib/pdfPayrollBulletin');

// ── fixtures ─────────────────────────────────────────────────────────────────

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

function reset(): void {
  pdfTexts.length = 0;
  pdfSaves.length = 0;
  pdfRects.length = 0;
  pdfImages.length = 0;
  pdfDocs.length = 0;
  stampCalls.length = 0;
}

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
  it('draws the full bulletin (title, school identity, period) and saves the file', async () => {
    reset();
    await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr' });

    assert.equal(pdfDocs.length, 1, 'one A4 document is built');
    assert.ok(pdfTexts.includes('BULLETIN DE PAIE'), 'the bulletin title is drawn');
    assert.ok(pdfTexts.includes('Mensuelle'), 'the "Mensuelle" subtitle is drawn');
    assert.ok(pdfTexts.includes('LYCEE PRIVE MAMA THERA DE SAFO (MAMI\'S)'), 'the school line is drawn');
    assert.ok(pdfTexts.includes('CERCLE DE KATI, COMMUNE DE SAFO'), 'the school address is drawn');
    assert.ok(pdfTexts.some(t => t.startsWith('Mois de : ')), 'the payroll month is drawn');
    assert.ok(pdfTexts.some(t => t.startsWith('Du : ')), 'the period start is drawn');

    assert.equal(pdfSaves.length, 1);
    assert.match(pdfSaves[0]!, /^Bulletin_Paie_Ibrahim_Thera_\d{4}-\d{2}\.pdf$/, 'filename carries the member name and period');
  });

  it('computes INPS 3,60 % and AMO 3,06 % on the base salary and prints the net', async () => {
    reset();
    await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr' });

    // 200000 × 3,60 % = 7 200 ; × 3,06 % = 6 120 ; total cotisations = 13 320 ; net = 186 680
    // toLocaleString('fr-FR') emits narrow no-break spaces — compare space-normalized.
    const drawn = pdfTexts.map(t => t.replace(/\s+/g, ' '));
    assert.ok(drawn.includes('3,60'), 'the INPS rate 3,60 is printed in the TAUX column');
    assert.ok(drawn.includes('3,06'), 'the AMO rate 3,06 is printed in the TAUX column');
    assert.ok(drawn.some(t => t.includes('Cotisation INPS (3,60% × salaire de base)')), 'the INPS label with the rate is drawn');
    assert.ok(drawn.some(t => t.includes('Cotisation AMO (3,06% × salaire de base)')), 'the AMO label with the rate is drawn');
    assert.ok(drawn.includes('7 200 FCFA'), 'INPS amount = 3,60 % of the base salary');
    assert.ok(drawn.includes('6 120 FCFA'), 'AMO amount = 3,06 % of the base salary');
    assert.ok(drawn.includes('13 320 FCFA'), 'total contributions = INPS + AMO');
    assert.ok(drawn.includes('186 680 FCFA'), 'net salary = base − contributions');

    const words = montantEnLettres(186680);
    assert.equal(words, 'cent quatre-vingt-six mille six cent quatre-vingts');
    assert.ok(
      pdfTexts.some(t => t.includes('Montant en toutes lettres') && t.includes('francs CFA')),
      'the net amount is written out in words',
    );
  });

  it('prints the member identity, bank account and the two signature blocks', async () => {
    reset();
    await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr' });

    assert.ok(pdfTexts.includes('Nom') && pdfTexts.includes('Thera'), 'family name label and value are drawn');
    assert.ok(pdfTexts.includes('Prénom') && pdfTexts.includes('Ibrahim'), 'given name label and value are drawn');
    assert.ok(pdfTexts.some(t => t.includes('Proviseur')), 'the position is drawn');
    assert.ok(pdfTexts.some(t => t.includes('BOA 12345678901')), 'the bank account number is drawn');
    assert.ok(pdfTexts.includes('L\'EMPLOYÉ'), 'the employee signature block is drawn');
    assert.ok(pdfTexts.includes('L\'EMPLOYEUR'), 'the employer signature block is drawn');
  });

  it('draws the official stamp exactly once, inside the employer signature block', async () => {
    reset();
    await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr' });

    assert.equal(stampCalls.length, 1, 'the school stamp is drawn exactly once');
    const stamp = stampCalls[0]!;
    assert.equal(stamp.doc, pdfDocs[0], 'the stamp is drawn on the same document');
    // Employer box spans x 108–200, y = sigTop–sigTop+24 ; stamp center (154, sigTop+13), d=20
    assert.equal(stamp.cx, 154, 'stamp center x = 154 mm (middle of the employer box)');
    assert.equal(stamp.diameterMm, 20, 'stamp diameter = 20 mm');
    assert.ok(stamp.cx - stamp.diameterMm / 2 >= 108, 'stamp stays inside the employer box');
    assert.ok(stamp.cx + stamp.diameterMm / 2 <= 200, 'stamp stays inside the employer box');
    assert.ok(stamp.cy - stamp.diameterMm / 2 >= 0 && stamp.cy + stamp.diameterMm / 2 <= 297, 'stamp fits on the A4 page');
  });

  it('embeds the uploaded school logo in the header emblem, and survives a broken one', async () => {
    reset();
    await generateAdminBulletinPdf({
      staffMember: adminMember,
      lang: 'fr',
      schoolLogo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    assert.equal(pdfImages.length, 1, 'the school logo is embedded');

    reset();
    await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr', schoolLogo: 'not-an-image' });
    assert.equal(pdfDocs.length, 1, 'a broken logo never breaks the payslip');
    assert.equal(pdfSaves.length, 1, 'the document is still saved');
  });

  it('fills the payroll-details grid and the allowances with real staff data', async () => {
    reset();
    const fullMember: Staff = {
      ...adminMember,
      inpsNumber: '1234567890',
      hireDate: '2023-10-02',
      familyStatus: 'married',
      childrenCount: 3,
      travelAllowance: 10000,
      communicationAllowance: 5000,
      housingAllowance: 15000,
    };
    await generateAdminBulletinPdf({ staffMember: fullMember, lang: 'fr' });

    const drawn = pdfTexts.map(t => t.replace(/\s+/g, ' '));
    // Employee details grid — real values instead of the fill-in dashes
    assert.ok(drawn.includes('1234567890'), 'the INPS number is drawn');
    assert.ok(drawn.includes('02/10/2023'), 'the hire date is drawn in French format');
    assert.ok(drawn.includes('Marié(e)'), 'the family status is drawn translated');
    assert.ok(drawn.includes('3'), 'the children count is drawn');

    // Allowances: base 200000 + 10000 + 5000 + 15000 → gross 230000
    assert.ok(drawn.includes('10 000 FCFA'), 'travel allowance drawn');
    assert.ok(drawn.includes('5 000 FCFA'), 'communication allowance drawn');
    assert.ok(drawn.includes('15 000 FCFA'), 'housing allowance drawn');
    assert.ok(drawn.includes('230 000 FCFA'), 'gross total = base + allowances');
    // Contributions stay computed on the BASE salary (frozen rates)
    assert.ok(drawn.includes('7 200 FCFA'), 'INPS still 3,60 % of the base salary');
    assert.ok(drawn.includes('6 120 FCFA'), 'AMO still 3,06 % of the base salary');
    assert.ok(drawn.includes('216 680 FCFA'), 'net = gross − contributions');

    // Without details, the grid falls back to dashes (never crashes)
    reset();
    await generateAdminBulletinPdf({ staffMember: adminMember, lang: 'fr' });
    assert.equal(pdfDocs.length, 1, 'a member without details still gets a bulletin');
    assert.equal(pdfSaves.length, 1, 'and it is still saved');
  });
});