// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/test-integrity.mjs — detect suites that cannot fail.
//
// A green suite is not the same as a suite that ran. This project has already
// paid for three versions of that confusion, all of them silent:
//
//   • `mock.module()` registered for a module nobody loads. The mock is inert,
//     the suite passes, and the contract it claims to prove is not proven —
//     mocking `node:fs` while the code under test reads `node:fs/promises` is
//     the same shape.
//   • platform behavior asserted without injecting the platform. The suite then
//     exercises the HOST branch: red on the other CI OS, or — worse — green
//     everywhere while testing nothing about the branch it names.
//   • a suite skipped on one platform. Its tests never run there, yet the job
//     reports a plain "Tests ✓"; the missing coverage is invisible.
//
// All three are decidable from the source, which is why this is a static gate
// and not a runtime one. It is deliberately conservative: every rule below was
// calibrated so the CURRENT repository is clean, because a gate that is red on
// legitimate code is a gate people learn to route around.
//
// Two reading rules keep it honest, both learned by watching this gate misjudge
// its own suite on the first run:
//   • comments never count — a rule must judge commands, not prose about them;
//   • template-literal CONTENT never counts either — a suite that builds a
//     fixture in a backtick string is writing code as DATA, and reading it as
//     code makes the gate accuse the very suite that tests it.
//
// The analysis is pure (files are read through an injected reader when one is
// given), so the rules are unit-tested on fixtures instead of being asserted
// structurally — see tests/test-integrity-guard.test.ts.
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';

import { maskComments } from './source-text.mjs';

const SCAN_DIRS = ['tests', 'src', 'scripts'];
const PROJECT_FILE = /\.(ts|tsx|mjs|js|cjs)$/;
const SUITE_FILE = /\.test\.(ts|tsx)$/;
const RESOLVE_EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs'];

/**
 * Markers a host-dependent neutrality must carry, so the gap is declared and
 * printed. Two markers, because two different things get neutralized: an entire
 * suite (a real skip) or a single assertion (an early return inside a test).
 */
export const PLATFORM_SKIP_MARKER = '@platform-skip';
export const PLATFORM_GUARD_MARKER = '@platform-guard';

/** Literals that mean "this suite is about platform behavior". */
const PLATFORM_LITERALS = /('win32'|"win32"|'linux'|"linux"|'darwin'|"darwin"|cmd\.exe|powershell|taskkill)/i;

/** Rules, each with the failure it prevents and the way out. */
export const RULES = {
  'mock-orphan': {
    label: 'mock sans effet (le module mocké n’est jamais chargé)',
    remedy:
      'Personne ne charge ce module : vérifiez le spécifieur (node:fs vs node:fs/promises, ' +
      'chemin relatif, paquet réellement importé) ou retirez le mock — un mock inerte fait ' +
      'passer la suite sans rien prouver.',
  },
  'mock-empty': {
    label: 'mock vide (il n’enregistre rien)',
    remedy:
      'Déclarez les exports réellement remplacés (`mockModule(spec, { … })`), ou supprimez l’appel : ' +
      'un mock vide ne change aucun comportement.',
  },
  'platform-not-injected': {
    label: 'plateforme non injectée (le test suit l’OS du poste)',
    remedy:
      'Passez la plateforme explicitement (`{ platform: \'win32\' }`, plus le cas `\'linux\'`) ' +
      'au lieu d’hériter de `process.platform` : la branche nommée doit s’exécuter sur TOUTE ' +
      'machine, pas seulement sur celle qui l’a écrit.',
  },
  'platform-skip-undeclared': {
    label: 'suite sautée selon la plateforme, sans déclaration',
    remedy:
      `Annotez la suite avec \`// ${PLATFORM_SKIP_MARKER} : <raison>\` : le saut reste légitime ` +
      '(un .cmd a besoin de cmd.exe), mais il doit être VISIBLE — le gate l’imprime dans son ' +
      'résumé à chaque run au lieu de laisser croire que la suite a tourné.',
  },
  'platform-guard-undeclared': {
    label: 'assertion neutralisée selon la plateforme, sans déclaration',
    remedy:
      `Annotez le cas avec \`// ${PLATFORM_GUARD_MARKER} : <raison>\` : si l’assertion ne peut ` +
      'pas exister sur cette plateforme, le dire explicitement — sinon elle disparaît en ' +
      'silence et le test reste vert sans rien vérifier.',
  },
  'no-assertion': {
    label: 'suite sans aucune assertion',
    remedy: 'Une suite qui n’assert rien ne peut pas échouer. Ajoutez les assertions, ou supprimez le fichier.',
  },
};

const rel = (root, abs) => path.relative(root, abs).split(path.sep).join('/');
const posixJoin = (dir, spec) => path.posix.normalize(path.posix.join(dir, spec));

/**
 * Blank out line and block comments while preserving string literals.
 *
 * A naive line-comment strip would also eat the `//` inside `'http://…'` and
 * truncate a real statement, and specifiers live in strings — so this walks the
 * source with a small state machine instead.
 * @param {string} src
 * @returns {string} same length-ish source with comments removed
 */
export function stripComments(src) {
  let out = '';
  let state = 'code';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'template';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      }
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
      } else {
        if (c === '\n') out += c; // keep line numbers usable
        i += 1;
      }
      continue;
    }
    // Inside a string: copy verbatim, honouring escapes.
    out += c;
    if (c === '\\') {
      out += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if ((state === 'single' && c === "'") || (state === 'double' && c === '"') || (state === 'template' && c === '`')) {
      state = 'code';
    }
    i += 1;
  }
  return out;
}

/**
 * Blank the CONTENT of template literals, keeping every other character and all
 * line numbers intact.
 *
 * A text-based gate cannot tell code from code-as-data. A suite that builds a
 * fixture inside a backtick string — this gate's own suite does exactly that —
 * would otherwise read as a suite full of inert mocks and host-dependent skips.
 * Blanking the literals (not the quotes, and never comments) keeps the rules
 * looking at CODE, which is what they are about.
 * @param {string} src
 * @returns {string}
 */
export function maskTemplateLiterals(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c !== '`') {
      out += c;
      i += 1;
      continue;
    }
    out += '`';
    i += 1;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === '`') {
        out += '`';
        i += 1;
        break;
      }
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
    }
  }
  return out;
}

/**
 * Every module specifier a source file loads at runtime.
 *
 * `import type` / `export type` statements are erased by the compiler, so they
 * do not count: counting them would let a mock look "used" by a type-only
 * relationship that never loads anything.
 * @param {string} src
 * @returns {string[]} deduplicated specifiers, in source order
 */
export function collectSpecifiers(src) {
  const runtime = stripComments(src)
    .replace(/\bimport\s+type\s[^;]*?from\s*['"][^'"]+['"]/g, '')
    .replace(/\bexport\s+type\s[^;]*?from\s*['"][^'"]+['"]/g, '');
  const patterns = [
    /from\s*['"]([^'"]+)['"]/g, // import … from 'x'  /  export … from 'x'
    /import\s*\(\s*['"]([^'"]+)['"]/g, // await import('x')
    /require\s*\(\s*['"]([^'"]+)['"]/g, // require('x')
    /import\s+['"]([^'"]+)['"]/g, // import 'x' (side effect)
  ];
  const found = [];
  for (const re of patterns) {
    for (const m of runtime.matchAll(re)) if (!found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/**
 * Resolve a specifier to a stable key: a repo-relative file path for relative
 * imports (so the SUT's own `./lib/foo` and a suite's `../scripts/lib/foo`
 * compare equal), the package name for bare imports, and the builtin name for
 * `node:x`/`x` (so a mock of `node:fs` matches an import of `node:fs`).
 * @param {string} spec
 * @param {string} fromRel repo-relative path of the importing file
 * @param {{ fileSet: Set<string>, root: string }} ctx
 * @returns {string}
 */
export function resolveSpecifier(spec, fromRel, ctx) {
  if (spec.startsWith('.')) {
    const base = posixJoin(path.posix.dirname(fromRel), spec);
    const candidates = [base, ...RESOLVE_EXTS.map((e) => base + e), ...RESOLVE_EXTS.map((e) => `${base}/index${e}`)];
    for (const c of candidates) if (ctx.fileSet.has(c)) return c;
    for (const c of candidates) if (fs.existsSync(path.join(ctx.root, c))) return c;
    return base;
  }
  return spec.startsWith('node:') ? spec.slice('node:'.length) : spec;
}

/**
 * Transitive module closure of a file: everything it can cause to be loaded.
 * @param {string} entryRel
 * @param {{ readSrc: (f: string) => string, fileSet: Set<string>, root: string }} ctx
 * @returns {Set<string>} keys reachable from the entry (the entry itself excluded)
 */
export function importClosure(entryRel, ctx) {
  const keys = new Set();
  const seen = new Set([entryRel]);
  const queue = [entryRel];
  while (queue.length > 0) {
    const file = queue.pop();
    for (const spec of collectSpecifiers(ctx.readSrc(file))) {
      const key = resolveSpecifier(spec, file, ctx);
      keys.add(key);
      if (ctx.fileSet.has(key) && !seen.has(key)) {
        seen.add(key);
        queue.push(key);
      }
    }
  }
  return keys;
}

/**
 * Module-mock registrations, with their line numbers: the raw
 * `mock.module('<spec>')` and the shared helper `mockModule('<spec>')` the
 * suites go through (see tests/module-mock.ts — the option NAME depends on the
 * runtime, so sites no longer name it themselves).
 *
 * The helper is in this vocabulary because a gate knows only what it can read:
 * leaving it out made the whole analysis go blind at once — measured, the
 * calibration test dropped to "seulement 0 mocks analysés" — and a gate that
 * silently stops matching is the failure mode this file exists to prevent.
 */
export function mockedModules(stripped) {
  const out = [];
  const patterns = [
    /mock\.module\(\s*['"]([^'"]+)['"]/g,
    /\bmockModule\(\s*['"]([^'"]+)['"]/g,
  ];
  const lines = stripped.split('\n');
  lines.forEach((line, i) => {
    for (const re of patterns) {
      for (const m of line.matchAll(re)) out.push({ spec: m[1], line: i + 1 });
    }
  });
  return out;
}

/**
 * Mocks that register nothing: `{}`, an empty `namedExports`/`exports`, or the
 * helper called with an empty object — the disguised form of the same thing.
 */
export function emptyMocks(stripped) {
  const out = [];
  const patterns = [
    /mock\.module\(\s*['"]([^'"]+)['"]\s*,\s*(?:\{\s*\}|(?:defaultExport\s*:\s*undefined\s*,?\s*)?\{\s*(?:namedExports|exports)\s*:\s*\{\s*\}\s*,?\s*\})/g,
    /\bmockModule\(\s*['"]([^'"]+)['"]\s*,\s*\{\s*\}\s*\)/g,
  ];
  const lines = stripped.split('\n');
  lines.forEach((line, i) => {
    for (const re of patterns) {
      for (const m of line.matchAll(re)) out.push({ spec: m[1], line: i + 1 });
    }
  });
  return out;
}

/** Recursively list the project files the gate analyses, as repo-relative paths. */
export function listProjectFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // a scan dir may legitimately be absent (e.g. fixtures in a tmp root)
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(abs);
      } else if (PROJECT_FILE.test(entry.name)) {
        out.push(rel(root, abs));
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(root, dir));
  return out.sort();
}

/**
 * Analyse one suite.
 * @param {string} suiteRel
 * @param {object} ctx
 * @param {string} ctx.raw source with comments (the marker lives in one), template
 *                        literals already blanked so fixture text cannot declare anything
 * @param {Set<string>} ctx.declared markers this suite really declares in a comment
 * @param {string} ctx.screened source without comments AND without template-literal
 *                        content — the code the rules judge (fixtures are data)
 * @param {Set<string>} ctx.closure modules the suite can load
 * @param {Set<string>} ctx.platformModules project modules with an injectable platform
 * @param {(spec: string, from: string) => string} ctx.resolve
 * @returns {{ rule: string, line: number, detail: string }[]}
 */
export function analyzeSuite(suiteRel, ctx) {
  const findings = [];
  for (const { spec, line } of mockedModules(ctx.screened)) {
    if (!ctx.closure.has(ctx.resolve(spec, suiteRel))) {
      findings.push({ rule: 'mock-orphan', line, detail: `mock.module('${spec}')` });
    }
  }
  for (const { spec, line } of emptyMocks(ctx.screened)) {
    findings.push({ rule: 'mock-empty', line, detail: `mock.module('${spec}', {})` });
  }

  const touchesPlatform = PLATFORM_LITERALS.test(ctx.screened);
  const reachablePlatformModule = [...ctx.platformModules].filter((m) => ctx.closure.has(m));
  if (touchesPlatform && reachablePlatformModule.length > 0 && !/\bplatform\s*:/.test(ctx.screened)) {
    findings.push({
      rule: 'platform-not-injected',
      line: 1,
      detail: `${reachablePlatformModule.join(', ')} accepte \`platform\` mais la suite ne l’injecte jamais`,
    });
  }

  // Two neutralizations, deliberately kept apart: an entire suite skipped on an
  // OS (the job then reports "Tests ✓" for tests that never ran) and a single
  // assertion that silently returns early (the test passes having checked
  // nothing). Both are legitimate in rare cases — hence a declared marker
  // instead of a ban.
  if (/\bskip\s*:[^,}\n]*process\.platform/.test(ctx.screened) && !ctx.declared.has(PLATFORM_SKIP_MARKER)) {
    findings.push({
      rule: 'platform-skip-undeclared',
      line: 1,
      detail: 'saut conditionné par process.platform',
    });
  }
  if (/if\s*\(\s*process\.platform[^)]*\)\s*\{?\s*return\b/.test(ctx.screened) && !ctx.declared.has(PLATFORM_GUARD_MARKER)) {
    findings.push({
      rule: 'platform-guard-undeclared',
      line: 1,
      detail: '`return` anticipé conditionné par process.platform',
    });
  }

  if (!/\bassert\b/.test(ctx.screened) && !/\bexpect\s*\(/.test(ctx.screened)) {
    findings.push({ rule: 'no-assertion', line: 1, detail: 'aucun `assert`/`expect` dans le fichier' });
  }

  return findings;
}

/**
 * Find a declaration marker and the reason that follows it.
 *
 * The marker must be its OWN COMMENT LINE (`// @platform-skip : …`, or a `*`
 * continuation). That anchoring is not cosmetic: markers are instructions to
 * this gate, and a marker quoted inside a string — a fixture, a test name — is
 * data, not a declaration. Requiring a comment line keeps the two apart without
 * having to guess what a string is for.
 * @returns {string | null} the tidied reason, or null when the marker is absent
 */
function markerReason(source, marker) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i].match(/^\s*(?:\/\/|\*|#)\s*(@platform-[a-z-]+)\b(.*)$/);
    if (!head || head[1] !== marker) continue;
    const parts = [head[2]];
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j].match(/^\s*(?:\/\/|\*)\s?(.*)$/);
      if (!next) break;
      parts.push(next[1]);
      if (/[.!?](\s|$)/.test(next[1])) break;
    }
    // First sentence only — a `.` inside `.cmd` is not a sentence end, so the
    // dot must be followed by whitespace or the end of the text.
    const text = parts.join(' ').replace(/^\s*[:—–-]?\s*/, '').trim();
    const sentence = text.match(/^(.*?[.!?])(?=\s|$)/);
    const reason = (sentence ? sentence[1] : text).trim();
    if (!reason) return '';
    return reason.length > 120 ? `${reason.slice(0, 117).trimEnd()}…` : reason;
  }
  return null;
}

/**
 * Analyse the whole repository.
 * @param {{ root?: string }} [options]
 * @returns {{ findings: object[], suites: number, mocks: number, declaredSkips: string[] }}
 */
export function analyzeRepo({ root = process.cwd() } = {}) {
  const files = listProjectFiles(root);
  const fileSet = new Set(files);
  const cache = new Map();
  const readSrc = (file) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
      } catch {
        cache.set(file, '');
      }
    }
    return cache.get(file);
  };
  const resolve = (spec, from) => resolveSpecifier(spec, from, { fileSet, root });
  const platformModules = new Set(
    files.filter(
      (f) => f.startsWith('scripts/') && /platform\s*[=:]\s*process\.platform/.test(stripComments(readSrc(f))),
    ),
  );

  const findings = [];
  const declaredSkips = [];
  const suites = files.filter((f) => SUITE_FILE.test(f));
  let mocks = 0;
  for (const suite of suites) {
    // Two views of the same source, and the distinction matters: `decl` keeps
    // comments (the declaration markers live in one) but blanks template-literals
    // so a fixture cannot declare a skip; `screened` has neither comments nor
    // literal content, and is what every rule actually judges.
    //
    // Both go through the SHARED scanner (scripts/lib/source-text.mjs), and that
    // is load-bearing rather than cosmetic: stripping comments with a regexp
    // reads `'https://…'` as a comment (the `//` is INSIDE the literal) and
    // deletes the code that follows it on the line — a rule would then judge
    // neither the string nor the code. The scanner knows which is which, and it
    // keeps every offset, so findings still print the right line.
    // Deux nuances mesurées sur ce gate, et aucune n'est cosmétique :
    //   • les règles LISENT les spécifieurs (`mock.module('node:fs')`) : blanchir
    //     toutes les chaînes leur donne des mocks vidés de leur cible — 34 faux
    //     « mock sans effet » au premier essai ;
    //   • les fixtures de sa PROPRE suite contiennent des backticks *dans* un
    //     gabarit, ce qui fait basculer n'importe quel scanner (les backticks ne
    //     s'imbriquent pas) : c'est le masquage gabarit historique qui est
    //     verrouillé par ses tests, et il reste donc en place.
    // Ce qui change ici, c'est le COMMENTAIRE : il est blanchi par le scanner
    // partagé au lieu d'être retiré par une expression régulière — celle-ci voit
    // le `//` de `'https://…'` comme un commentaire et supprime le code qui suit
    // sur la même ligne.
    const decl = maskTemplateLiterals(readSrc(suite));
    const screened = maskTemplateLiterals(maskComments(readSrc(suite)));
    mocks += mockedModules(screened).length;
    const declared = new Set();
    for (const [marker, kind] of [
      [PLATFORM_SKIP_MARKER, 'suite sautée'],
      [PLATFORM_GUARD_MARKER, 'assertion sautée'],
    ]) {
      const reason = markerReason(decl, marker);
      if (reason === null) continue;
      declared.add(marker);
      declaredSkips.push(`${suite} (${kind})${reason ? ` — ${reason}` : ''}`);
    }
    const closure = importClosure(suite, { readSrc, fileSet, root });
    for (const finding of analyzeSuite(suite, { raw: decl, declared, screened, closure, platformModules, resolve })) {
      findings.push({ ...finding, file: suite });
    }
  }
  return { findings, suites: suites.length, mocks, declaredSkips };
}
