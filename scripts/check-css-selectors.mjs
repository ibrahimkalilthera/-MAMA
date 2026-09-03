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
    '   element of that tag in the app — including themed overlays (Productivité\n' +    '   panel, side panels). That is how the white-on-white overlay bug happened.\n' +
    '   Scope it: `.app-sidebar` for the nav rail, `.app-header`, or any other\n' +
    '   component class. Same rule of thumb for any tag shared by overlays:\n' +
    '   scope by class, never by bare tag.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// White-text regression guards (the "parent name invisible" family of bugs).
// ---------------------------------------------------------------------------
// The app theme is class-based; `dark:` must follow the `.dark` ancestor, and
// the slate theme's !important remap layer must keep darkening the pastel
// alert/badge family. Any of the checks below failing = a white-on-white
// surface is back.

const CSS_GUARDS = [
  {
    file: 'src/index.css',
    needle: 'prefers-color-scheme',
    absent: true, // must NOT be present — the OS media query must never reappear
    label: 'the OS media query must never reappear',
  },
  {
    file: 'src/index.css',
    needle: '.theme-slate .bg-rose-50',
    label: 'the slate pastel-surface remap must stay (white headings on pastel cards otherwise)',
  },
  {
    file: 'src/index.css',
    needle: '.theme-slate .text-rose-600',
    label: 'the slate rose-text remap must stay (dark rose on dark cards is unreadable)',
  },
  {
    file: 'src/components/AppModals.tsx',
    needle: 'text-sm font-black text-slate-900 dark:text-white',
    label: 'the Relance parent-name span must stay theme-safe (dark in light themes, white in dark themes)',
  },
];

const guardViolations = [];
for (const g of CSS_GUARDS) {
  if (!fs.existsSync(g.file)) {
    guardViolations.push(`${g.file}  —  missing (${g.label})`);
    continue;
  }
  // CSS files: comments are stripped so an explanatory comment can mention
  // `prefers-color-scheme` without tripping the OS-media-query guard.
  const content = g.file.endsWith('.css')
    ? stripComments(fs.readFileSync(g.file, 'utf8'))
    : fs.readFileSync(g.file, 'utf8');
  const found = content.includes(g.needle);
  if ((g.absent && found) || (!g.absent && !found)) {
    guardViolations.push(
      `${g.file}  —  ${g.absent ? 'must NOT contain' : 'must contain'} ${JSON.stringify(g.needle)}  (${g.label})`
    );
  }
}

if (guardViolations.length > 0) {
  console.error('❌ White-text regression guards failed:');
  for (const v of guardViolations) console.error(`   ${v}`);
  console.error(
    '\n   These guards lock the fixes for the invisible-parent-name bugs.\n' +
    '   If you are intentionally changing the theming model, update the guards\n' +
    '   and re-verify contrast in ALL six themes.'
  );
  process.exit(1);
}
