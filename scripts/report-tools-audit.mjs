/**
 * Warning-only audit of the ISOLATED trees under `tools/`.
 *
 * Two trees live outside the root lockfile today, each for the same reason —
 * a dev-only tool whose transitive pins cannot be fixed from here — and each
 * gets its own line here so neither can go quiet:
 *
 *   • `tools/`             the Vercel CLI (tar, undici, js-yaml, …), tracked
 *                          weekly by vercel-pins-watch.yml;
 *   • `tools/csslint/`     stylelint + its two plugins. Its `micromatch →
 *                          braces@3.0.3` has NO patched release upstream
 *                          (`<= 3.0.3`, patched: none), so the only honest way
 *                          out of the root gate was to move the linter out —
 *                          the same remedy the Vercel CLI got. There is no
 *                          upstream fix to wait for: this one is visible, not
 *                          pending (see scripts/lib/stylelint-tools.mjs).
 *
 * This job keeps BOTH visible on every push WITHOUT ever failing:
 *
 *   • report-only — always exits 0, so the quality workflow stays green and
 *     deploy.yml (triggered by its success) can never be blocked by it;
 *   • `continue-on-error` on the CI job is the belt on top of that;
 *   • visibility comes from a `::warning` annotation + the job step summary;
 *   • the root gate stays strict and unaffected (`scripts/check-audit.mjs`).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SPAWN_OPTS = { shell: process.platform === 'win32' };

/** Les arbres isolés, chacun avec la RAISON de son isolement. */
export const ISOLATED_TREES = [
  {
    dir: 'tools',
    label: 'Vercel CLI pins',
    why: 'dev-only transitive pins of the deploy CLI',
    followUp: 'Deeper follow-up every Monday: `vercel-pins-watch` probes the latest release and opens a tracking issue when a clean tree ships.',
  },
  {
    dir: 'tools/csslint',
    label: 'CSS lint (stylelint → braces)',
    why: 'stylelint ships `micromatch → braces@3.0.3`, and `braces` has NO patched release upstream (`<= 3.0.3`)',
    followUp: 'The CSS gate is unchanged (same stylelint version, same `stylelint.config.js`, run by `scripts/stylelint-tools.mjs`) — the linter moved, the check did not.',
  },
];

/** Total vulnerabilities of one isolated lockfile tree — no install needed. */
function auditTree(dir) {
  // Bounded + retried: the npm audit endpoint has gone 503/timeout for hours
  // during registry incidents. A hanging spawn would otherwise trip the CI
  // job timeout, and a job TIMED OUT cancels the whole workflow run — which
  // deploy.yml gates on — so this warning-only job must never hang. Two
  // short attempts, then give up gracefully (exit 0 path below).
  for (let attempt = 1; attempt <= 2; attempt++) {
    const r = spawnSync(NPM, ['audit', '--json', '--fetch-timeout=45000', '--fetch-retries=1'], {
      cwd: dir, encoding: 'utf8', timeout: 90000, ...SPAWN_OPTS,
    });
    if (r.stdout) {
      try {
        const data = JSON.parse(r.stdout);
        const total = data.metadata && data.metadata.vulnerabilities && data.metadata.vulnerabilities.total;
        if (typeof total === 'number') return total;
      } catch {
        // fall through to retry / unavailable
      }
    }
    if (r.status === 0) return 0; // clean exit, nothing to report
    if (attempt === 1) console.log(`• ${dir}/ audit attempt 1 failed, retrying…`);
  }
  return null;
}

function appendSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, markdown + '\n');
  } catch {
    // a failed summary write must never fail this warning-only job
  }
}

const results = ISOLATED_TREES.map((tree) => ({ tree, total: auditTree(tree.dir) }));

const unavailable = results.filter((r) => r.total === null);
const dirty = results.filter((r) => typeof r.total === 'number' && r.total > 0);

for (const { tree, total } of dirty) {
  console.log(
    `::warning title=${tree.label} (${total})::${total} known dev-only vulnerabilities remain in the isolated tree ${tree.dir}/ ` +
      `(${tree.why}). The root gate stays at 0 and this tree is never bundled. Non-blocking by design.`,
  );
}
for (const { tree } of unavailable) {
  console.log(
    `::warning title=tools audit unavailable (${tree.dir})::The ${tree.dir}/ audit could not run ` +
      `(registry unreachable or npm failure) — non-blocking by design.`,
  );
}

appendSummary(
  [
    '## Tools audit (warning-only)',
    '',
    '| isolated tree | vulnerabilities | why it is outside the root lockfile |',
    '| --- | --- | --- |',
    ...results.map(({ tree, total }) => {
      const cell = total === null ? '⚠️ could not run' : total === 0 ? '✅ 0' : `⚠️ ${total}`;
      return `| \`${tree.dir}/\` | ${cell} | ${tree.why} |`;
    }),
    '',
    '- Never bundled into the app; the **root audit gate stays strict** (`scripts/check-audit.mjs`, production clean + total within baseline).',
    ...results.filter(({ tree }) => tree.followUp).map(({ tree }) => `- ${tree.dir}/ — ${tree.followUp}`),
    '- This job is **non-blocking by design**: it must never stop the deploy workflow.',
  ].join('\n'),
);

for (const { tree, total } of results) {
  console.log(
    total === null
      ? `• ${tree.dir}/ audit unavailable — reported as a warning, exit 0`
      : `• ${tree.dir}/ tree: ${total} vulnerabilities — warning-only, exit 0`,
  );
}
