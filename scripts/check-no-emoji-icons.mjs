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
 * Two properties this scan must keep, and both were missing before:
 *   • **prose is not markup** — the masking is now the SHARED one
 *     (`scripts/lib/source-text.mjs`), because four hand-rolled strip helpers
 *     lived in four checks and each was one regex away from eating real code;
 *   • **reading nothing is not passing** — an empty `src/` (moved root, changed
 *     filter) printed a green with zero files behind it. `assertScanned` fails
 *     instead (exit 2), and `CHECK_EMOJI_ROOT` lets a suite prove both
 *     properties on a fixture rather than on the real tree.
 *
 * Usage: node scripts/check-no-emoji-icons.mjs (wired into `npm run lint`).
 */

import fs from 'node:fs';

import { assertScanned, lineAt, lineIndex, listFiles, maskProse } from './lib/source-text.mjs';

// Emoji blocks: pictographs (1F000–1FAFF, incl. regional indicators 1F1E6–
// 1F1FF, ZWJ sequences via their base chars), misc symbols + dingbats
// (2600–27BF: ⚠ ✕ ✓ ★ ❤ 🟢 🎓 …), arrows/geometrics (2B00–2BFF) and the
// emoji variation selector FE0F (catches a base that lost its block above).
const EMOJI_RE = /(?:[\u{1F000}-\u{1FAFF}]|[\u{2600}-\u{27BF}]|[\u{2B00}-\u{2BFF}]|\u{FE0F})/gu;

const ROOT = process.env.CHECK_EMOJI_ROOT || 'src';

/**
 * Remove <option …>…</option> spans: SVG is illegal inside <option>, so the
 * wizard's colored dots are legitimately text (the documented exception).
 */
const stripOptions = (code) => code.replace(/<option\b[^>]*>[\s\S]*?<\/option>/gi, '');

let bad = 0;
const files = listFiles(ROOT, { ext: /\.tsx$/ });
// 0 fichier lu ⇒ rien n'a été vérifié : échec, jamais un vert.
assertScanned(files, { what: 'fichier .tsx', root: ROOT });

for (const file of files) {
  const raw = fs.readFileSync(file, 'utf8');
  // Comments and literals blanked by the shared scanner, keeping every offset
  // and every line number: a finding below maps back to the real source line.
  const masked = stripOptions(maskProse(raw));
  const lineOf = lineIndex(masked);
  for (const m of masked.matchAll(EMOJI_RE)) {
    bad += 1;
    const ln = lineOf(m.index);
    console.log(`❌ ${file}:${ln}: ${lineAt(raw, ln).trim().slice(0, 140)}`);
  }
}

if (bad > 0) {
  console.log(`\n${bad} occurrence(s) d'emoji brut dans le JSX de ${ROOT}/ — remplacez par une icône lucide (ou mettez le texte dans une string).`);
  process.exit(1);
}
console.log(`✅ Aucun emoji brut dans le JSX de ${ROOT}/ — les icônes viennent de lucide (${files.length} fichier(s) scanné(s)).`);
