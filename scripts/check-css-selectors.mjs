/**
 * CSS selector hygiene gate.
 *
 * Blocks bare structural type selectors in src/index.css (and any future CSS
 * file under src/). A selector segment that is exactly `aside`, `header`,
 * `footer`, `nav` or `main` (no class/id/attr/pseudo, no ancestor context)
 * matches EVERY element of that tag in the app — including themed overlays:
 * the Productivité panel is a <motion.aside>, and this is precisely how the
 * white-on-white AI-tab bug happened (`aside { color:#FFF !important }`,
 * meant for the nav rail, clobbered the panel's theme tokens).
 *
 * Scoped uses stay allowed on purpose — `.app-sidebar nav`, `.overlay
 * header` and `aside.app-sidebar` target one tree, not the whole app. Only
 * the naked tag as a full segment trips the gate:
 *
 *   ✗  main { … }            ✗  aside, .foo { … }   (segment `aside`)
 *   ✓  .app-sidebar nav …    ✓  aside.app-sidebar …  ✓  main.app-main …
 *
 * Deliberately narrow: comments, strings and `-aside`/`header-x` never
 * match. Runs inside `npm run lint` (pre-commit + CI quality job).
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['src'];

/** Structural tags shared by app chrome and overlays. */
const BARE_TAGS = new Set(['aside', 'header', 'footer', 'nav', 'main']);

/** Strip CSS comments so commented-out examples don't trip the gate. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Split a selector-ish line into comma-separated trimmed segments. */
function segments(selectorPart) {
  return selectorPart
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
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
    const lines = stripped.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only inspect selector-ish text: up to the first '{' of the line.
      const braceIdx = line.indexOf('{');
      const selectorPart = braceIdx === -1 ? line : line.slice(0, braceIdx);
      for (const seg of segments(selectorPart)) {
        // Exact naked tag: `aside` — but not `aside:hover`, `.x aside`,
        // `aside.app-sidebar` etc.
        if (BARE_TAGS.has(seg)) {
          violations.push(`${file}:${i + 1}  —  bare \`${seg}\` selector  →  ${line.trim().slice(0, 100)}`);
          break;
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`❌ Bare structural element selectors found (${violations.length}):`);
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '\n   A naked `aside`/`header`/`footer`/`nav`/`main` segment matches EVERY\n' +
    '   element of that tag in the app — including themed overlays (Productivité\n' +
    '   panel, side panels). That is how the white-on-white overlay bug happened.\n' +
    '   Scope it: `.app-sidebar` for the nav rail, `.app-header`, or any other\n' +
    '   component class. Same rule of thumb for any tag shared by overlays:\n' +
    '   scope by class, never by bare tag.'
  );
  process.exit(1);
}