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
 *
 * La prose CSS est blanchie par la SEULE règle du dépôt,
 * `maskMarkupComments` (scripts/lib/source-text.mjs). Ce fichier portait sa
 * propre copie, qui repliait un bloc sur un espace — donc SUPPRIMAIT des sauts
 * de ligne, et décalait d'autant les numéros de ligne rapportés. Une seule
 * règle, et elle préserve la longueur : un décalage trouvé désigne la bonne
 * ligne.
 *
 * The theme checks further down read the theme CSS CORPUS (src/index.css +
 * src/themes/*.css, resolved by ./lib/theme-css.mjs) instead of one hard-coded
 * path. That is not decoration: when the remap layer was extracted to
 * src/themes/overrides.css, a path-based guard would have kept passing while
 * checking nothing — the file still exists, it simply no longer holds the
 * rules. Only the OS-media-query check stays per-file: it is an invariant of
 * EVERY stylesheet under src/, so a new file must not be able to hide it.
 */
import fs from 'node:fs';
import path from 'node:path';

import { assertScanned, maskMarkupComments } from './lib/source-text.mjs';
import { readThemeCss, themeCssFiles } from './lib/theme-css.mjs';

const ROOTS = process.env.CHECK_CSS_ROOTS ? process.env.CHECK_CSS_ROOTS.split(',') : ['src'];

/** Structural tags shared by app chrome and overlays. */
const BARE_TAGS = new Set(['aside', 'header', 'footer', 'nav', 'main']);

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
/**
 * Sélecteurs qu'un `#` rend ILLISIBLES par le pipeline qui les expédie.
 *
 * Ce n'est pas de la cosmétique de style : le CSS de `src/` n'est pas servi tel
 * quel, il est LU par `lightningcss` (via `@tailwindcss/vite`, la chaîne que
 * `npm run build` emprunte). Une seule faute de frappe suffit donc à faire
 * disparaître une règle ENTIÈRE — et sans un mot, puisque le build réussit.
 *
 * Les deux formes mesurées le 2026-10-15, chacune par la règle qu'elle a tuée :
 *   • `.theme-cream .bg-[#F8FAFC]` — crochets NUS : ils se lisent comme un
 *     sélecteur d'attribut sans nom qualifié (« No qualified name in attribute
 *     selector ») et emportent les quatre surfaces crème du même groupe.
 *   • `.theme-slate .bg-\[#121212\]` — crochet ÉCHAPPÉ mais `#` NU devant un
 *     CHIFFRE (« Unexpected token Hash(\"121212]\") ») : cinq sélecteurs ainsi
 *     écrits ont tenu les 42 surfaces du blanchiment ardoise à l'écart de TOUS
 *     les builds, production comprise — c'est l'encre profonde de la pastille
 *     « Enregistrer Salaire » relevée à 1,41:1 par `npm run check:contrast`.
 *
 * La forme que le parseur accepte est celle du reste du corpus : crochets
 * échappés (`\[`), et `#` échappé SEULEMENT quand l'hexadécimal commence par un
 * chiffre (`\[\#121212\]`), le `#` d'un `\[#F8FAFC\]` passant tel quel.
 */
const parseHazards = [];
let scanned = 0;
for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  for (const file of cssFiles(root)) {
    scanned += 1;
    const stripped = maskMarkupComments(fs.readFileSync(file, 'utf8'));
    const lines = stripped.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Only inspect selector-ish text: up to the first '{' of the line.
      const braceIdx = line.indexOf('{');
      const selectorPart = braceIdx === -1 ? line : line.slice(0, braceIdx);
      const nakedBracket = /(^|[^\\])\[#/.test(selectorPart);
      const bareHashBeforeDigit = /\\\[#\d/.test(selectorPart);
      if (nakedBracket) {
        parseHazards.push(`${file}:${i + 1}  —  crochet NU devant « # » (la règle entière est jetée par le pipeline)  →  ${line.trim().slice(0, 100)}`);
      } else if (bareHashBeforeDigit) {
        parseHazards.push(`${file}:${i + 1}  —  « # » NU devant un CHIFFRE après « \\[ » (la règle entière est jetée)  →  ${line.trim().slice(0, 100)}`);
      }
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

if (parseHazards.length > 0) {
  console.error(`❌ Selectors the CSS pipeline would DROP whole (${parseHazards.length}):`);
  for (const v of parseHazards) console.error(`   ${v}`);
  console.error(
    '\n   `src/` CSS is PARSED by lightningcss (@tailwindcss/vite) before it ships: one\n' +
    '   unreadable selector and the ENTIRE rule disappears from the build — silently,\n' +
    '   because the build still succeeds. Write the bracket escaped (`\\[`) and the\n' +
    '   `#` escaped too when the hex starts with a digit: `.theme-x .bg-\\[\\#121212\\]`.\n' +
    '   See scripts/check-css-selectors.mjs (parse hazards) for the two measured cases.'
  );
  process.exit(1);
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
    // The Relance parent-name span moved with the NotifyParentModal extraction.
    file: 'src/components/NotifyParentModal.tsx',
    needle: 'text-sm font-black text-slate-900 dark:text-white',
    label: 'the Relance parent-name span must stay theme-safe (dark in light themes, white in dark themes)',
  },
  {
    needle: '.theme-slate .bg-rose-50',
    label: 'the slate pastel-surface remap must stay (white headings on pastel cards otherwise)',
  },
  {
    needle: '.theme-slate .text-rose-600',
    label: 'the slate rose-text remap must stay (dark rose on dark cards is unreadable)',
  },
];

const guardViolations = [];

// The OS media query must never come back in ANY stylesheet (comments are
// stripped so an explanatory comment may still name it).
for (const file of cssFiles('src')) {
  if (maskMarkupComments(fs.readFileSync(file, 'utf8')).includes('prefers-color-scheme')) {
    guardViolations.push(
      `${file}  —  must NOT contain "prefers-color-scheme"  (the OS media query must never reappear)`
    );
  }
}

// Content checks read the CORPUS, never a path.
const THEME_FILES = themeCssFiles();
const THEME_CSS = maskMarkupComments(readThemeCss());
const CORPUS = THEME_FILES.join(', ');

for (const g of CSS_GUARDS) {
  if (g.file) {
    if (!fs.existsSync(g.file)) {
      guardViolations.push(`${g.file}  —  missing (${g.label})`);
    } else if (!fs.readFileSync(g.file, 'utf8').includes(g.needle)) {
      guardViolations.push(`${g.file}  —  must contain ${JSON.stringify(g.needle)}  (${g.label})`);
    }
    continue;
  }
  if (!THEME_CSS.includes(g.needle)) {
    guardViolations.push(
      `theme CSS corpus (${CORPUS})  —  must contain ${JSON.stringify(g.needle)}  (${g.label})`
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
//      group and the text-slate family — in BOTH of its two halves: the
//      DESCENDANT one (`… .bg-white :is(…)`, an ink inside the surface) and
//      the SELF one (`… .bg-white:is(…)`, an element that IS the surface and
//      carries its own ink). Bright accent surfaces (bg-emerald-500/600,
//      bg-blue-600, …) are excluded by luminance — no heading ever sits on a
//      CTA button, and whitening one there would break it.
//
//      Why the SELF half is an invariant and not a detail: it was MISSING, and
//      only the browser audit could see it. `bg-white text-slate-800` on ONE
//      element (the payroll “Enregistrer Salaire” pill) is repainted #334155
//      by the remap layer while the descendant-only rule leaves the ink deep —
//      measured 1.41:1 (slate) and 1.21:1 (midnight) in Chrome. The static
//      model whitened that pair anyway (it resolves text against the sibling
//      bg token, not against the DOM), so every parser-based lock agreed with
//      a CSS rule that did not exist. This check is what keeps the two halves
//      together.

// 1. Blanket heading rule absent — in ANY corpus file: the remap layer may
// move between files, the invariant may not.
if (/\n\.theme-slate\s+h[1-4](?=[,{])/.test('\n' + THEME_CSS)) {
  guardViolations.push(
    `theme CSS corpus (${CORPUS})  —  the blanket \`.theme-slate h1..h4 { color:#F8FAFC !important }\` ` +
    'whitening is back; headings must only be whitened by the scoped dark-surface rule'
  );
}

// 2. Blanket slate-text utility rule absent (standalone selector lines).
const bareTextWhiten = /^\s*\.theme-slate \.text-slate-(950|900|800|700|600)\s*(,|\{)\s*$/m;
if (bareTextWhiten.test(THEME_CSS)) {
  guardViolations.push(
    `theme CSS corpus (${CORPUS})  —  a bare \`.theme-slate .text-slate-950|900|800|700|600 { … }\` ` +
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
const corpusLines = THEME_CSS.split(/\r?\n/);
for (let i = 0; i < corpusLines.length; i++) {
  // `\s*` avant l'accolade : les règles écrites `.theme-slate .bg-white {`
  // (une seule surface, accolade détachée) étaient INVISIBLES à ce lecteur —
  // `bg-white` manquait donc à la liste des surfaces dérivées, et l'invariant
  // ci-dessous ne le vérifiait pas. Mesuré : 39 tokens lus, 42 en réalité.
  const sel = corpusLines[i].match(/^\.theme-slate \.([^\s,{]+),?\s*\{?$/);
  if (!sel) continue;
  const token = sel[1];
  // Only background/card surface rules feed the scope list (text-/border-/
  // hover-bg remaps and accent utilities never contain headings).
  if (!/^(bg-|card-)/.test(token)) continue;
  // Scan this rule for its background declaration (same or following lines).
  let bg = null;
  for (let j = i + 1; j < Math.min(i + 6, corpusLines.length); j++) {
    const line = corpusLines[j].trim();
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

const SCOPE_TAIL = ':is(h1, h2, h3, h4, .text-slate-950';
const missingFromScope = [];
const missingSelfScope = [];
for (const token of darkSurfaceTokens) {
  // One entry per surface must whiten BOTH the heading group and the
  // slate-neutral text family (they share the same `:is(…)` list), in BOTH
  // halves of the rule: the descendant one and the self one.
  if (!THEME_CSS.includes(`.theme-slate .${token} ${SCOPE_TAIL}`)) {
    missingFromScope.push(token);
  }
  if (!THEME_CSS.includes(`.theme-slate .${token}${SCOPE_TAIL}`)) {
    missingSelfScope.push(token);
  }
}
if (missingFromScope.length > 0) {
  guardViolations.push(
    `theme CSS corpus (${CORPUS})  —  slate surfaces painted dark without a matching heading+text scope entry: ` +
    missingFromScope.join(', ') +
    ' (add `.theme-slate .' + missingFromScope[0] +
    ' :is(h1, h2, h3, h4, .text-slate-950, .text-slate-900, .text-slate-800, .text-slate-700, .text-slate-600)` to the scoped rule)'
  );
}
if (missingSelfScope.length > 0) {
  guardViolations.push(
    `theme CSS corpus (${CORPUS})  —  slate surfaces painted dark without the SELF half of the ink scope: ` +
    missingSelfScope.join(', ') +
    ' (add `.theme-slate .' + missingSelfScope[0] +
    ':is(h1, h2, h3, h4, .text-slate-950, .text-slate-900, .text-slate-800, .text-slate-700, .text-slate-600)` — an element that carries the surface AND its own slate ink keeps deep ink on a dark fill otherwise: the “Enregistrer Salaire” pill measured 1.41:1 in Chrome)'
  );
}

// 0 feuille lue ⇒ aucune règle n'a été vérifiée : c'est un échec, pas un vert.
// (Le corpus de thèmes a son propre garde ; celui-ci protège la lecture CSS.)
assertScanned({ length: scanned }, { what: 'feuille .css', root: ROOTS.join(', ') });

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
