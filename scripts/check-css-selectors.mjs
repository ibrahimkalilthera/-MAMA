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
    // The Relance parent-name span moved with the NotifyParentModal extraction.
    file: 'src/components/NotifyParentModal.tsx',
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

// ---------------------------------------------------------------------------
// Slate heading + text scoping — the blanket `.theme-slate h1..h4` and
// `.theme-slate .text-slate-900/800/700/600/950` whitening must never come
// back, and the scoped rule must mirror every background the slate theme
// actually paints dark.
// ---------------------------------------------------------------------------
// The old catch-alls whitened headings AND every slate-neutral text utility
// on EVERY surface — including surfaces that stay light (pastel badges,
// ticket/print zones), i.e. white-on-pale. They are now flipped to light
// only when an ancestor belongs to the slate dark system (the scoped
// `:is(h1, h2, h3, h4, .text-slate-950, …, .text-slate-600)` rule). Three
// invariants:
//
//   1. No bare `.theme-slate h1`..`h4` element selector may exist anywhere
//      (comment-stripped): that is the blanket rule by definition.
//   2. No bare `.theme-slate .text-slate-950|900|800|700|600` utility
//      selector may exist as a standalone line: that would whiten slate
//      text on light surfaces again (the invisible parent-name family).
//   3. Every *dark* surface the slate theme remaps (bg-*/card-* with a dark
//      value) must also appear in the scoped rule with BOTH the heading
//      group and the text-slate family. Bright accent surfaces
//      (bg-emerald-500/600, bg-blue-600, …) are excluded by luminance — no
//      heading ever sits on a CTA button, and whitening one there would
//      break it.

const INDEX_CSS = stripComments(fs.readFileSync('src/index.css', 'utf8'));

// 1. Blanket heading rule absent.
if (/\n\.theme-slate\s+h[1-4](?=[,{])/.test('\n' + INDEX_CSS)) {
  guardViolations.push(
    'src/index.css  —  the blanket `.theme-slate h1..h4 { color:#F8FAFC !important }` ' +
    'whitening is back; headings must only be whitened by the scoped dark-surface rule'
  );
}

// 2. Blanket slate-text utility rule absent (standalone selector lines).
const bareTextWhiten = /^\s*\.theme-slate \.text-slate-(950|900|800|700|600)\s*(,|\{)\s*$/m;
if (bareTextWhiten.test(INDEX_CSS)) {
  guardViolations.push(
    'src/index.css  —  a bare `.theme-slate .text-slate-950|900|800|700|600 { … }` ' +
    'whitening is back; slate text must only be whitened by the scoped dark-surface rule'
  );
}

// 2. Heading scope ⊇ dark surface remaps.
function relativeLuminance(hex) {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return 0.5; // unknown → assume dark-ish/intent
  const chan = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

const darkSurfaceTokens = new Set();
const indexLines = INDEX_CSS.split(/\r?\n/);
for (let i = 0; i < indexLines.length; i++) {
  const sel = indexLines[i].match(/^\.theme-slate \.([^\s,{]+),?\{?$/);
  if (!sel) continue;
  const token = sel[1];
  // Only background/card surface rules feed the scope list (text-/border-/
  // hover-bg remaps and accent utilities never contain headings).
  if (!/^(bg-|card-)/.test(token)) continue;
  // Scan this rule for its background declaration (same or following lines).
  let bg = null;
  for (let j = i + 1; j < Math.min(i + 6, indexLines.length); j++) {
    const line = indexLines[j].trim();
    const bm = line.match(/^background(?:-color)?:\s*([^;!]+)/);
    if (bm) {
      bg = bm[1].trim();
      break;
    }
    if (line.startsWith('}') || /^[^:]+:\s*#/.test(line)) break; // other decl or block end
  }
  if (!bg) continue;
  const isTranslucent = bg.startsWith('rgba') || bg.startsWith('rgb(') || bg.startsWith('linear-gradient');
  const hex = bg.match(/#[0-9a-fA-F]{6}/);
  // Translucent tints sit on the theme's own dark cards → dark. Solid hex
  // counts only if darker than the bright-accent threshold.
  if (isTranslucent || (hex && relativeLuminance(hex[0]) < 0.32)) {
    darkSurfaceTokens.add(token);
  }
}

const missingFromScope = [];
for (const token of darkSurfaceTokens) {
  // One entry per surface must whiten BOTH the heading group and the
  // slate-neutral text family (they share the same `:is(…)` list).
  if (!INDEX_CSS.includes(`.theme-slate .${token} :is(h1, h2, h3, h4, .text-slate-950`)) {
    missingFromScope.push(token);
  }
}
if (missingFromScope.length > 0) {
  guardViolations.push(
    'src/index.css  —  slate surfaces painted dark without a matching heading+text scope entry: ' +
    missingFromScope.join(', ') +
    ' (add `.theme-slate .' + missingFromScope[0] +
    ' :is(h1, h2, h3, h4, .text-slate-950, .text-slate-900, .text-slate-800, .text-slate-700, .text-slate-600)` to the scoped rule)'
  );
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
