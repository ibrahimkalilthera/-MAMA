/**
 * CI ↔ package.json parity gate.
 *
 * Refuses any workflow step that RECOPIES a command package.json already
 * defines, instead of calling it by name. See scripts/lib/ci-commands.mjs for
 * the three rules and the allowlist; this file is the I/O edge.
 *
 * Why a gate and not a convention: the `quality` job once hand-ran a subset of
 * the lint chain (`npx eslint .` + `npx tsc` + two guards) and skipped six
 * gates in silence — stylelint and the test-harness guard among them — so CI
 * proved less than the machine while both looked green. A copy is invisible to
 * review because it reads like a normal CI step; the only thing that catches
 * every future copy is a machine that compares the two lists.
 *
 * The step that fails here is never the interesting one: the gate's first real
 * run found the contrast job calling `node scripts/theme-contrast-audit.mjs`
 * while `check:contrast` is that exact command — a duplicate definition of a
 * gate whose whole purpose is to be run identically everywhere.
 *
 * Usage: node scripts/check-ci-commands.mjs   (wired into `npm run lint`)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CI_ALLOWLIST,
  WORKFLOW_DIR,
  formatCiReport,
  inspectCiCommands,
} from './lib/ci-commands.mjs';

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/**
 * Every workflow, as text. A missing directory is an ERROR, not an empty list:
 * an unreadable path must never be reported as "nothing to complain about"
 * (the inert `git.cmd` shim is what that mistake cost this repo).
 */
function readWorkflows() {
  let names;
  try {
    names = readdirSync(join(root, WORKFLOW_DIR));
  } catch {
    console.error(`❌ ${WORKFLOW_DIR}/ est illisible — le garde CI ne peut rien prouver.`);
    process.exit(1);
  }
  return names
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()
    .map((n) => ({ file: `${WORKFLOW_DIR}/${n}`, text: readFileSync(join(root, WORKFLOW_DIR, n), 'utf8') }));
}

const result = inspectCiCommands({ pkg, workflows: readWorkflows(), allowlist: CI_ALLOWLIST });
for (const line of formatCiReport(result)) {
  if (line.startsWith('❌')) console.error(line);
  else console.log(line);
}

const failed =
  result.violations.length > 0 || result.staleAllowlist.length > 0 || result.scanned.commands === 0;
if (failed) {
  console.error(
    `\n${result.violations.length} commande(s) de CI recopiée(s) depuis package.json — ` +
      'une copie diverge en silence : appelez le script par son nom (npm run <script>).',
  );
  process.exit(1);
}
