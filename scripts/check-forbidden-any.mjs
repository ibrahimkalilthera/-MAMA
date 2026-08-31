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
 * Scope is src/ per the project's policy (tests are covered by the same ESLint
 * rules; other explicit-any forms like `Array<any>` are caught by no-explicit-any).
 * Case-sensitive on purpose: `as Any` would be a legitimate custom type.
 *
 * Runs as part of `npm run lint` (ESLint → tsc → props wiring → this gate), so
 * it is enforced by the husky pre-commit hook and the CI `quality` job.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src';
const PATTERNS = [
  { re: /\bas\s+any\b/, label: '`as any`' },
  { re: /@ts-ignore/, label: '`@ts-ignore`' },
  { re: /@ts-expect-error/, label: '`@ts-expect-error`' },
  { re: /@ts-nocheck/, label: '`@ts-nocheck`' },
];

/** Recursively list src/ files ending in .ts/.tsx (sorted for stable output). */
function tsFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

const violations = [];
const files = tsFiles(ROOT);
for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
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

console.log(`✅ src/ sans \`as any\`, \`@ts-ignore\`, \`@ts-expect-error\`, \`@ts-nocheck\` — ${files.length} fichier(s) scanné(s)`);
