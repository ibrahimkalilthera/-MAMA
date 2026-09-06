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
import path from 'node:path';

const ROOT = 'src';

/** Recursively list src/ files ending in .ts/.tsx (sorted for stable output). */
function tsFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

// A comparison touching getMonth: === !== > >= < <= (also <= index etc.)
const COMPARE = /\.getMonth\(\)\s*(===|!==|>=|<=|>|<)/;
// The pairing that makes the comparison year-safe, on the same line.
const PAIRED = /(\.getFullYear\(\)|sameYearMonth\(|inAcademicYear\(|academicYearOf\(|currentYearMonth\()/;

const violations = [];
const files = tsFiles(ROOT);
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return; // comments
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
console.log(`✅ aucune comparaison .getMonth() sans année — ${files.length} fichier(s) scanné(s)`);