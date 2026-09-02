/**
 * Test-harness hygiene gate.
 *
 * Forbids re-introducing the INLINE happy-dom setup that the shared harness
 * refactor (tests/harness.ts, commit 6df9278) removed from every suite.
 * Before that refactor, each suite duplicated a ~20-line block:
 *
 *   function installDomGlobals() {
 *     const win = new Window({ url: 'http://localhost/' });
 *     Object.defineProperty(globalThis, 'window', { value: win, ... });
 *     ...
 *     Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', ...);
 *     return win;
 *   }
 *
 * The refactor cut 505 duplicated lines; suites now import
 * `installDomGlobals` / `stubAlert` / `renderHook` from './harness'. This
 * gate keeps it that way by flagging the four markers that only existed in
 * the duplicated blocks (zero legit occurrences today):
 *
 *   ✗  function installDomGlobals() / const installDomGlobals = …
 *      → local re-definition instead of `import { installDomGlobals } …`
 *   ✗  new Window( … )
 *      → direct happy-dom instantiation instead of the harness's Window
 *   ✗  IS_REACT_ACT_ENVIRONMENT
 *      → part of the duplicated installer block
 *   ✗  import { … } from 'happy-dom'
 *      → direct happy-dom import instead of through the harness
 *
 * Deliberately narrow: comments are stripped before matching (suites may
 * explain the boundary in prose), per-suite extras via
 * `Object.defineProperty(globalThis, …)` stay allowed (floating-chat's
 * KeyboardEvent, focus-stack's document stubs, supabase-client's storage
 * spies), and tests/harness.ts itself is exempt.
 *
 * Runs inside `npm run lint` (pre-commit + CI quality job).
 */
import fs from 'node:fs';
import path from 'node:path';

const TESTS_DIR = 'tests';
const EXEMPT = new Set(['harness.ts']);

/** Strip line and block comments so prose never trips the gate. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ');
}

const PATTERNS = [
  {
    name: 'local re-definition of installDomGlobals',
    re: /\b(function\s+installDomGlobals\b|(?:const|let|var)\s+installDomGlobals\s*=\s*(?:\(|\w))/,
    hint: 'import { installDomGlobals } from \'./harness\' instead of re-defining it.',
  },
  {
    name: 'direct happy-dom Window instantiation',
    re: /\bnew\s+Window\s*\(/,
    hint: 'happy-dom windows come from tests/harness.ts (installDomGlobals), not from suites.',
  },
  {
    name: 'IS_REACT_ACT_ENVIRONMENT literal',
    re: /\bIS_REACT_ACT_ENVIRONMENT\b/,
    hint: 'that flag is part of the harness installer — suites never set it themselves.',
  },
  {
    name: 'direct happy-dom import',
    re: /from\s*['"]happy-dom['"]/,
    hint: 'import Window/Storage types through tests/harness.ts, not happy-dom directly.',
  },
];

const violations = [];
const files = fs
  .readdirSync(TESTS_DIR)
  .filter((f) => /\.test\.(ts|tsx)$/.test(f) && !EXEMPT.has(f))
  .sort();

for (const file of files) {
  const stripped = stripComments(fs.readFileSync(path.join(TESTS_DIR, file), 'utf8'));
  const lines = stripped.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re, hint } of PATTERNS) {
      if (re.test(lines[i])) {
        violations.push(
          `${file}:${i + 1}  —  ${name}  →  ${lines[i].trim().slice(0, 90)}\n` +
          `       ${hint}`
        );
        break;
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`❌ Inline happy-dom setup found (${violations.length} violation(s)):`);
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '\n   The shared harness (tests/harness.ts) centralises installDomGlobals,\n' +
    '   stubAlert and renderHook — suites must import them, not re-paste the\n' +
    '   ~20-line block. If a NEW capability is needed, extend the harness once\n' +
    '   (e.g. an option in installDomGlobals) instead of copying code into a suite.'
  );
  process.exit(1);
}