/**
 * Raw-emoji guard — role/status icons must come from lucide, not emoji text.
 *
 * Emoji glyphs (🤖 ✓ ✕ ⚠ ❤ …) render at platform-dependent sizes and styles,
 * break the 4px icon scale and look unprofessional next to lucide strokes.
 * The icon pass already converted every inline emoji icon to a lucide
 * component; this guard keeps them out.
 *
 * What it scans:      src/**\/*.tsx — raw emoji sitting in JSX *markup*
 *                     (not inside a string literal or comment).
 * What stays legal:
 *   • Emoji inside string literals and comments — toast bodies,
 *     translations, AI report text and doc comments are *content*, not
 *     chrome icons; the toast/translation systems render their own lucide
 *     type icons already.
 *   • Emoji inside `<option>…</option>` — browsers strip SVG inside
 *     <option>, so the Promotion wizard's 🟢/🟠/🎓/🔴 state dots are the one
 *     documented exception (see PromotionWizardModal).
 * What fails:         any remaining emoji in JSX children — e.g. a
 *                     `<span className="…">🤖</span>` icon.
 *
 * Usage: node scripts/check-no-emoji-icons.mjs (wired into `npm run lint`).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Emoji blocks: pictographs (1F000–1FAFF, incl. regional indicators 1F1E6–
// 1F1FF, ZWJ sequences via their base chars), misc symbols + dingbats
// (2600–27BF: ⚠ ✕ ✓ ★ ❤ 🟢 🎓 …), arrows/geometrics (2B00–2BFF) and the
// emoji variation selector FE0F (catches a base that lost its block above).
const EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2B00}-\u{2BFF}]|\u{FE0F})/gu;

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');

/** Strip JS string literals and template literals (content, not markup). */
const stripStrings = (code) =>
  code
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gs, '``');

/** Strip line + block comments (doc text, not markup) — whole-file aware. */
const stripComments = (code) =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * Remove <option …>…</option> spans: SVG is illegal inside <option>, so the
 * wizard's colored dots are legitimately text (the documented exception).
 */
const stripOptions = (code) => code.replace(/<option\b[^>]*>[\s\S]*?<\/option>/gi, '');

const walk = (dir, acc = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.tsx$/.test(entry)) acc.push(p);
  }
  return acc;
};

let bad = 0;
for (const file of walk(SRC)) {
  const code = readFileSync(file, 'utf8');
  // Line-start offsets map a stripped-file offset back to its source line.
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };

  const stripped = stripOptions(stripComments(stripStrings(code)));
  for (const m of stripped.matchAll(EMOJI_RE)) {
    bad += 1;
    const ln = lineOf(m.index);
    const raw = code.split(/\r?\n/)[ln - 1] ?? '';
    console.log(`❌ ${file.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '')}:${ln}: ${raw.trim().slice(0, 140)}`);
  }
}

if (bad > 0) {
  console.log(`\n${bad} occurrence(s) d'emoji brut dans le JSX de src/ — remplacez par une icône lucide (ou mettez le texte dans une string).`);
  process.exit(1);
}
console.log('✅ Aucun emoji brut dans le JSX de src/ — les icônes viennent de lucide.');
