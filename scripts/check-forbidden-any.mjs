/**
 * Forbidden-cast gate — the `any`-policy's second line of defence.
 *
 * Blocks in src/ (belt to eslint.config.js's suspenders):
 *   • `as any` (also catches `as any[]`, `as unknown as any`) —
 *     @typescript-eslint/no-explicit-any already errors on these at the AST level;
 *   • `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` —
 *     @typescript-eslint/ban-ts-comment already errors on these too
 *     (including described @ts-expect-error).
 *
 * Why duplicate what ESLint does:
 *   • an inline `/* eslint-disable @typescript-eslint\/no-explicit-any *\/` would
 *     silence the AST rule but not this scan;
 *   • this file is scanned by plain text, so it survives any future ESLint
 *     config reshuffle that accidentally narrows the rule's file scope.
 *
 * TWO PROPERTIES THIS SCAN MUST KEEP, and neither is decorative:
 *
 *   1. **prose is not code.** A doc comment explaining the ban, an example in a
 *      string, a message that says « as any » — none of those is a violation, and
 *      a raw line regexp would flag them. A gate that cries wolf on its own
 *      documentation gets muted, and a muted gate is absent. Prose is blanked by
 *      the shared scanner (`scripts/lib/source-text.mjs`), which keeps line
 *      numbers exact.
 *   2. **reading nothing is not passing.** The scan used to print
 *      « ✅ … — 0 fichier(s) scanné(s) » when `src/` moved or the filter changed:
 *      a green with nothing behind it. `assertScanned` fails instead (exit 2).
 *      The root is overridable (`CHECK_FORBIDDEN_ANY_ROOT`) precisely so a suite
 *      can prove both properties on a fixture instead of on the real tree.
 *
 * Scope is src/ per the project's policy (tests are covered by the same ESLint
 * rules; other explicit-any forms like `Array<any>` are caught by no-explicit-any).
 * Case-sensitive on purpose: `as Any` would be a legitimate custom type.
 *
 * Runs as part of `npm run lint` (ESLint → tsc → props wiring → this gate), so
 * it is enforced by the husky pre-commit hook and the CI `quality` job.
 */
import fs from 'node:fs';

import { SOURCE_EXTS, assertScanned, listFiles, maskProse } from './lib/source-text.mjs';

const ROOT = process.env.CHECK_FORBIDDEN_ANY_ROOT || 'src';
const PATTERNS = [
  { re: /\bas\s+any\b/, label: '`as any`' },
  { re: /@ts-ignore/, label: '`@ts-ignore`' },
  { re: /@ts-expect-error/, label: '`@ts-expect-error`' },
  { re: /@ts-nocheck/, label: '`@ts-nocheck`' },
];

const violations = [];
const files = listFiles(ROOT, { ext: SOURCE_EXTS });
assertScanned(files, { what: 'fichier .ts/.tsx', root: ROOT });

for (const file of files) {
  const code = maskProse(fs.readFileSync(file, 'utf8'));
  const lines = code.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const { re, label } of PATTERNS) {
      if (re.test(line)) violations.push(`${file}:${i + 1}  —  ${label}  →  ${line.trim().slice(0, 100)}`);
    }
  });
}

if (violations.length > 0) {
  console.error(`❌ Forbidden casts/suppressions in src/ (${violations.length}):`);
  for (const v of violations) console.error(`   ${v}`);
  console.error(
    '\n   Fix the real typing instead. A described @ts-expect-error is still a\n   suppression: the type system must be right, not silenced.'
  );
  process.exit(1);
}

console.log(`✅ ${ROOT}/ sans \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`, \`@ts-nocheck\` — ${files.length} fichier(s) scanné(s) (prose blanchie)`);
