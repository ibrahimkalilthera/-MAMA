/**
 * CSS selector hygiene gate.
 *
 * Blocks, in src/index.css (and any future CSS file under src/):
 *   • bare `aside` type selectors (as a selector segment) — an unscoped
 *     element selector hits EVERY <aside> in the app, including themed
 *     overlays (the Productivité panel is a <motion.aside>). This is exactly
 *     how the white-on-white AI-tab bug happened: a `aside { color:#FFF
 *     !important }` rule meant for the nav rail clobbered the panel's theme
 *     tokens. Target `.app-sidebar` (the class on the real nav rail) instead.
 *
 * Deliberately narrow: it flags `aside` only where a selector is expected —
 * not inside comments, strings, or as part of `.my-aside` / `#aside-x`.
 * Runs inside `npm run lint` (enforced by pre-commit + CI quality job).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src'];

/** `aside` as a selector segment: start/after comma/space/combinator, not
 *  followed by a name/hyphen char (so `-aside`, `aside-x` don't match) and
 *  not preceded by . # [ : (class/id/attr/pseudo). */
const BARE_ASIDE = /(^|[,\s>+~(])aside\b(?![\w-])/;

/** Strip CSS comments so commented-out examples don't trip the gate. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Rough statement splitter: a "selector" is text before `{` at depth 0. */
function selectorSegments(css) {
  const segments = [];
  let depth = 0;
  let current = '';
  for (const ch of css) {
    if (ch === '{') {
      depth += 1;
      if (depth === 1) {
        segments.push(current);
        current = '';
        continue;
      }
    } else if (ch === '}') {
      depth -= 1;
      current = '';
      continue;
    }
    current += ch;
  }
  return segments;
}

function cssFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.css$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

const violations = [];
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of cssFiles(root)) {
    const stripped = stripComments(fs.readFileSync(file, 'utf8'));
    // Split into lines-with-offsets for precise line numbers.
    const lines = stripped.split(/\r?\n/);
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only inspect selector-ish text: the segment up to the first '{' of
      // this line (a selector line never contains a declaration's ':').
      const braceIdx = line.indexOf('{');
      const selectorPart = braceIdx === -1 ? line : line.slice(0, braceIdx);
      if (BARE_ASIDE.test(selectorPart)) {
        violations.push(`${file}:${i + 1}  —  bare \`aside\` selector  →  ${line.trim().slice(0, 100)}`);
      }
      void offset;
    }
  }
}

if (violations.length > 0) {
  console.error(`❌ Bare element selectors for \`aside\` found (${violations.length}):`);
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '\n   An unscoped `aside` rule hits EVERY <aside> in the app — including\n' +
    '   themed overlays (Productivité panel, future side panels). Target the\n' +
    '   component class instead: the nav rail is `.app-sidebar` (Sidebar.tsx).\n' +
    '   Same rule of thumb for any element tag shared by overlays (dialog,\n' +
    '   header, nav…): scope by class, never by bare tag.'
  );
  process.exit(1);
}
