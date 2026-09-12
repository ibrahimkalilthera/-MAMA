/**
 * The theme CSS corpus — every stylesheet whose rules implement the app's
 * theming, in cascade order.
 *
 * Why a module: the remap layer is not one file. It lives in src/index.css's
 * own rules, in src/themes/midnight.css and in src/themes/overrides.css, and
 * its readers live in two different worlds — scripts/check-css-selectors.mjs
 * (the lint gate) and tests/tailwind-pairs.ts (the contrast model). Each of
 * them pointing at ONE hard-coded path is exactly how a guard goes VACUOUS
 * GREEN after a split: the path still exists, it simply no longer contains
 * what the guard is looking for. So the corpus is derived from the entry
 * stylesheet's own @import graph — the graph the browser resolves.
 *
 * Order is cascade order: an entry's @imports come first (in file order), then
 * the entry's own rules. Parsers that key a Map by selector therefore resolve
 * collisions the way the browser does — the LAST occurrence wins.
 *
 * Anything under src/themes/ that is NOT imported rides along anyway: a new
 * theme layer must be visible to the guards even before someone wires its
 * @import (an unloaded stylesheet is already a bug, but silence is worse).
 */

import fs from 'node:fs';
import path from 'node:path';

/** Entry stylesheet, project-relative: its @import graph defines the corpus. */
export const ENTRY = 'src/index.css';

/** Directory holding the per-theme layers. */
const THEMES_DIR = 'src/themes';

const toPosix = (p) => p.replace(/\\/g, '/');
const uniq = (list) => [...new Set(list)];

/**
 * Local (relative) `@import` targets of a stylesheet, in file order. Bare
 * specifiers are packages (`tailwindcss`) and never filesystem paths.
 * @param {string} css
 * @returns {string[]}
 */
export function localImports(css) {
  return [...css.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)]
    .map((m) => m[1])
    .filter((spec) => spec.startsWith('.'));
}

/**
 * Every `*.css` file directly inside a directory, sorted.
 * @param {string} dir absolute path
 * @returns {string[]} absolute paths
 */
function cssFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.css'))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/**
 * The corpus as project-relative posix paths, in cascade order.
 * @param {string} [root] project root (defaults to the cwd)
 * @returns {string[]}
 */
export function themeCssFiles(root = process.cwd()) {
  const entry = path.join(root, ENTRY);
  const imported = [];
  if (fs.existsSync(entry)) {
    for (const spec of localImports(fs.readFileSync(entry, 'utf8'))) {
      const resolved = path.resolve(path.dirname(entry), spec.replace(/[?#].*$/, ''));
      if (fs.existsSync(resolved)) imported.push(resolved);
    }
  }
  const ordered = uniq([...imported, ...cssFilesIn(path.join(root, THEMES_DIR)), entry]);
  return ordered.filter((p) => fs.existsSync(p)).map((p) => toPosix(path.relative(root, p)));
}

/**
 * The corpus text. Files are joined with a newline so a file boundary can
 * never glue two rule blocks into one unparsable chunk.
 * @param {string} [root] project root (defaults to the cwd)
 * @returns {string}
 */
export function readThemeCss(root = process.cwd()) {
  return themeCssFiles(root)
    .map((rel) => fs.readFileSync(path.join(root, rel), 'utf8'))
    .join('\n');
}
