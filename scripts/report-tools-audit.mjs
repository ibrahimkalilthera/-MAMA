/**
 * Warning-only audit of the isolated deploy CLI (tools/).
 *
 * The tools/ tree intentionally keeps the Vercel CLI OUT of the root lockfile:
 * its dev-only transitive pins (tar, undici, js-yaml, …) stay outside the
 * strict root audit gate and are never bundled (see DEVELOPMENT_HISTORY.md).
 * This job keeps those pins VISIBLE on every push WITHOUT ever failing:
 *
 *   • report-only — always exits 0, so the quality workflow stays green and
 *     deploy.yml (triggered by its success) can never be blocked by it;
 *   • `continue-on-error` on the CI job is the belt on top of that;
 *   • visibility comes from a `::warning` annotation + the job step summary;
 *   • the deeper weekly follow-up (probe the latest release, open/refresh the
 *     tracking issue) lives in vercel-pins-watch.yml.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SPAWN_OPTS = { shell: process.platform === 'win32' };

/** Total vulnerabilities of the tools/ lockfile tree — no install needed. */
function auditTools() {
  const r = spawnSync(NPM, ['audit', '--json'], { cwd: 'tools', encoding: 'utf8', ...SPAWN_OPTS });
  if (!r.stdout) return null;
  try {
    const data = JSON.parse(r.stdout);
    const total = data.metadata && data.metadata.vulnerabilities && data.metadata.vulnerabilities.total;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
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

const total = auditTools();

if (total === null) {
  console.log('::warning title=tools audit unavailable::The tools/ audit could not run (registry unreachable or npm failure) — non-blocking by design.');
  appendSummary('## Tools audit (warning-only)\n\n⚠️ The audit could not run (registry unreachable or npm failure). Nothing was blocked.');
  console.log('• tools/ audit unavailable — reported as a warning, exit 0');
} else if (total > 0) {
  console.log(`::warning title=Vercel CLI pins (${total})::${total} known dev-only vulnerabilities remain in the isolated deploy CLI (tools/). The root gate stays at 0 and the CLI is never bundled. Tracked weekly by the vercel-pins-watch workflow. Non-blocking by design.`);
  appendSummary(
    [
      '## Tools audit (warning-only)',
      '',
      `⚠️ The isolated deploy CLI tree (\`tools/\`) carries **${total} known vulnerabilities** — dev-only pins of the Vercel CLI.`,
      '',
      '- Never bundled into the app; the **root audit gate stays at 0** (enforced strictly in the `quality` job).',
      '- Deeper follow-up every Monday: `vercel-pins-watch` probes the latest release and opens a tracking issue when a clean tree ships.',
      '- This job is **non-blocking by design**: it must never stop the deploy workflow.',
    ].join('\n'),
  );
  console.log(`• tools/ tree: ${total} vulnerabilities — warning-only, exit 0`);
} else {
  appendSummary('## Tools audit (warning-only)\n\n✅ The `tools/` tree audits **0** vulnerabilities — the upstream pins fix landed and is applied.');
  console.log('• tools/ tree: 0 vulnerabilities — clean 🎉');
}
