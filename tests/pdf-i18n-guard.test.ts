/**
 * Static guard over the PDF generators: printed documents (reçus, bordereaux,
 * rapports) must follow the app's chosen language from ONE place — the
 * central `translations` dictionary — never inline `isFr ? 'FR' : 'EN'`
 * ternaries.
 *
 * Why static: the generators run in the browser only, and their unit tests
 * mock jsPDF (which cannot assert that a *language* regression — a new
 * hardcoded English label — was reintroduced). This suite reads the sources
 * and enforces the contract:
 *
 *   1. every PDF-bearing file resolves its text through `translations`
 *      (lib generators derive `t` from `lang`; the two domain hooks already
 *      receive `t` as a prop);
 *   2. no `isFr ? '<text>' : '<text>'` ternary remains — the ONLY allowed
 *      use of `isFr ?` is the locale pair `isFr ? 'fr-FR' : 'en-US'` for
 *      date formatting;
 *   3. the `t.` key names used in PDF sources are parity-checked by
 *      scripts/l10n-verify.mjs (which now scans these files too) — this
 *      suite only locks the no-hardcoded-bilingual-text invariant.
 *
 * Pure suite: no DOM, no React — plain node:test + fs (same discipline as
 * pdf-stamp-guard.test.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every source that draws user-facing text on a PDF document. */
const PDF_SOURCES = [
  'src/lib/pdfReceipt.ts',
  'src/lib/pdfPayroll.ts',
  'src/lib/pdfPayrollDraft.ts',
  'src/lib/pdfExpensesReport.ts',
  'src/lib/pdfFinancialReport.ts',
  'src/lib/pdfMultiYearReport.ts',
  'src/app/useParents.ts',
  'src/app/usePayroll.ts',
];

describe('PDF i18n guard — documents follow the chosen language from one place', () => {
  it('every PDF source resolves text through the central translations dictionary', () => {
    for (const file of PDF_SOURCES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      if (file.startsWith('src/lib/')) {
        // Lib generators derive `t` from `lang` via the translations import.
        assert.match(src, /import\s*\{[^}]*translations[^}]*\}\s*from\s*['"]\.\.\/i18n\/translations['"]/,
          `${file}: must import the translations dictionary`);
        assert.match(src, /const\s+t\s*:\s*TranslationDict\s*=\s*lang\s*===\s*'fr'\s*\?\s*translations\.fr\s*:\s*translations\.en/,
          `${file}: must derive t from the chosen language`);
      } else {
        // Domain hooks receive `t` as a prop (TranslationDict).
        assert.match(src, /t\s*:\s*TranslationDict/, `${file}: must receive t as a prop`);
      }
    }
  });

  it('no `isFr ? \'<text>\'` ternary remains — only the fr-FR/en-US locale pair is allowed', () => {
    for (const file of PDF_SOURCES) {
      const src = readFileSync(join(ROOT, file), 'utf8');
      // Any isFr ? '<string>' where the string is not the date-locale 'fr-FR'
      // is a hardcoded bilingual label that must move into translations.ts.
      const matches = [...src.matchAll(/isFr\s*\?\s*'([^']*)'/g)];
      for (const m of matches) {
        assert.equal(m[1], 'fr-FR',
          `${file}: isFr ? '${m[1]}' — hardcoded text must live in translations.ts (t.* key)`);
      }
      // Template-literal ternaries (isFr ? `...` : `...`) are never allowed.
      assert.doesNotMatch(src, /isFr\s*\?\s*`/,
        `${file}: template-literal isFr ternary — use a t.* key`);
    }
  });
});