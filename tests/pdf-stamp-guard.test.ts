/**
 * Static guard over the 8 PDF generators: the school stamp must ALWAYS be
 * drawn as the real image (public/tampon.png via pdfStamp.ts) in its planned
 * zone — never as a "CACHET" text placeholder.
 *
 * Why static: the stamp module's fetch/canvas path is environment-bound
 * (browser-only), so each generator's own unit tests mock pdfStamp and
 * cannot see whether the REAL generator code regressed to a text
 * placeholder. This suite reads the sources and enforces the contract:
 *
 *   1. every generator imports drawSchoolStamp from pdfStamp;
 *   2. every generator calls `await drawSchoolStamp(...)` EXACTLY once
 *      (one stamp per document — a second call would double-stamp);
 *   3. the stamp call sits in its planned zone (a real 20–24 mm diameter
 *      circle, i.e. a sane stamp size — not a 1 px "whatever");
 *   4. no generator draws a "Cachet" / "CACHET" / "OFFICIAL STAMP" text
 *      placeholder anywhere (the image replaced those in the past);
 *   5. no generator ever used the old `y - 14` overlap pattern that made
 *      the stamp cover table rows (the salary-receipt bug) — regression
 *      lock for commit 6b146f7.
 *
 * Pure suite: no DOM, no React — plain node:test + fs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The 8 document generators that must each draw the school stamp. */
const GENERATORS: Array<{ file: string; minDiameter: number; maxDiameter: number }> = [
  // Payment receipt (A5): stamp inside the dedicated 55×22 mm cachet box.
  { file: 'src/lib/pdfReceipt.ts', minDiameter: 20, maxDiameter: 20 },
  // Employee payslip (A5): stamp inside the dedicated employer box.
  { file: 'src/lib/pdfPayroll.ts', minDiameter: 20, maxDiameter: 20 },
  // Monthly payroll draft / bordereau (A4 landscape).
  { file: 'src/lib/pdfPayrollDraft.ts', minDiameter: 24, maxDiameter: 24 },
  // Expenses report (A4).
  { file: 'src/lib/pdfExpensesReport.ts', minDiameter: 24, maxDiameter: 24 },
  // Financial report (A4).
  { file: 'src/lib/pdfFinancialReport.ts', minDiameter: 22, maxDiameter: 22 },
  // Multi-year comparison report (A4).
  { file: 'src/lib/pdfMultiYearReport.ts', minDiameter: 24, maxDiameter: 24 },
  // Consolidated salary receipt (A4) — the original overlap bug lived here.
  { file: 'src/app/usePayroll.ts', minDiameter: 22, maxDiameter: 22 },
  // Consolidated parent ledger receipt (A4) — same pattern as the salary one.
  { file: 'src/app/useParents.ts', minDiameter: 22, maxDiameter: 22 },
];

/** Placeholder strings that must NEVER be drawn as text again. */
const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /CACHET OFFICIEL|OFFICIAL STAMP|STAMP OFFICIEL/i, label: 'literal stamp placeholder' },
  { re: /t\.cachet\b|t\.officialStamp\b|t\.stampPlaceholder\b/, label: 'translation-key stamp placeholder' },
];

describe('PDF stamp guard — every generator draws the real image, never a placeholder', () => {
  for (const gen of GENERATORS) {
    const src = readFileSync(join(ROOT, gen.file), 'utf8');

    it(`${gen.file} imports and draws the school stamp exactly once`, () => {
      assert.match(src, /import\s*\{[^}]*drawSchoolStamp[^}]*\}\s*from\s*['"][^'"]*\/pdfStamp['"]/,
        'the generator must import drawSchoolStamp from pdfStamp');
      const calls = src.match(/await\s+drawSchoolStamp\s*\(/g) ?? [];
      assert.equal(calls.length, 1, `exactly one stamp draw expected, found ${calls.length}`);
    });

    it(`${gen.file} draws the stamp at the planned size (${gen.minDiameter} mm)`, () => {
      const m = src.match(/await\s+drawSchoolStamp\s*\(([^)]*)\)/);
      assert.ok(m, 'stamp call present');
      // Resolve named diameter constants (e.g. STAMP_DIAMETER = 22) declared
      // in the same file, so the guard works on literal and constant args.
      const raw = m[1]!.split(',').pop()!.trim();
      const constM = src.match(new RegExp(`const\\s+${raw}\\s*=\\s*(\\d+)`));
      const diameter = constM ? Number(constM[1]) : Number(raw);
      assert.ok(Number.isFinite(diameter), `diameter parsed from call: ${raw}`);
      assert.ok(diameter >= gen.minDiameter && diameter <= gen.maxDiameter,
        `diameter ${diameter} mm outside planned range [${gen.minDiameter}, ${gen.maxDiameter}]`);
    });

    it(`${gen.file} never draws a text stamp placeholder`, () => {
      for (const { re, label } of PLACEHOLDER_PATTERNS) {
        assert.doesNotMatch(src, re, `${label} must not appear in ${gen.file}`);
      }
    });
  }

  it('no generator uses the old y - 14 overlap pattern (the salary-receipt bug)', () => {
    for (const gen of GENERATORS) {
      const src = readFileSync(join(ROOT, gen.file), 'utf8');
      assert.doesNotMatch(src, /drawSchoolStamp\([^)]*\by\s*-\s*14\b/,
        `${gen.file}: stamp must never be positioned with the y-14 overlap pattern`);
    }
  });
});