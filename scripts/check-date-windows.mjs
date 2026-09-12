// Guard: a raw `.getMonth()` COMPARISON must be paired — on the same line —
// with a `.getFullYear()` comparison or a dateWindows helper
// (sameYearMonth / inAcademicYear / academicYearOf / currentYearMonth).
//
// Why: `date.getMonth() === currentMonth` silently mixes years (a September
// 2025 salary counted as "paid this month" in September 2026). The fixed sites
// in src/ use src/lib/dateWindows.ts; this guard makes the pairing structural
// so the bug class cannot come back.
//
// Non-comparison uses (setMonth arithmetic, padStart formatting, initial
// state, getMonth() + 1 labels) are intentionally allowed.
import fs from 'node:fs';

import { SOURCE_EXTS, assertScanned, listFiles, maskProse } from './lib/source-text.mjs';

// La racine est surchargeable pour que la propriété soit PROUVABLE sur une
// arborescence fabriquée : sans ce point d'entrée, le seul moyen de tester ce
// contrôle serait de casser le vrai dépôt — donc personne ne le testerait.
const ROOT = process.env.CHECK_DATE_WINDOWS_ROOT || 'src';

// A comparison touching getMonth: === !== > >= < <= (also <= index etc.)
const COMPARE = /\.getMonth\(\)\s*(===|!==|>=|<=|>|<)/;
// The pairing that makes the comparison year-safe, on the same line.
const PAIRED = /(\.getFullYear\(\)|sameYearMonth\(|inAcademicYear\(|academicYearOf\(|currentYearMonth\()/;

const violations = [];
const files = listFiles(ROOT, { ext: SOURCE_EXTS });
// Un scan vide n'est pas un vert : 0 fichier lu ⇒ sortie 2, avec la racine.
assertScanned(files, { what: 'fichier .ts/.tsx', root: ROOT });
for (const file of files) {
  // Prose blanche par le scanner partagé : un commentaire qui CITE
  // `.getMonth() ===` n'est pas une comparaison, et l'ancien filtre
  // (`trimmed.startsWith('//')`) laissait passer les commentaires en fin de
  // ligne — ceux-là mêmes qui documentent le piège.
  const lines = maskProse(fs.readFileSync(file, 'utf8')).split(/\r?\n/);
  lines.forEach((line, i) => {
    if (COMPARE.test(line) && !PAIRED.test(line)) {
      violations.push(`${file}:${i + 1}  —  .getMonth() comparison without year  →  ${line.trim().slice(0, 120)}`);
    }
  });
}

if (violations.length > 0) {
  console.error('Comparaisons mois-seul détectées — utilisez sameYearMonth()/inAcademicYear() (src/lib/dateWindows.ts) :');
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log(`✅ aucune comparaison .getMonth() sans année — ${files.length} fichier(s) scanné(s) (prose blanchie)`);