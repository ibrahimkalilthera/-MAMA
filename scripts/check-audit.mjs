/**
 * CI security gate — blocks reintroduced vulnerabilities at every push.
 *
 * Fails the build when either of these holds:
 *   1. ANY production/runtime dependency has a known vulnerability
 *      (`npm audit --omit=dev` non-empty) — nothing vulnerable may ship.
 *   2. The total vulnerability count exceeds the documented dev-only baseline
 *      (DEV_BASELINE = 0) — i.e. a brand-new vulnerability appears anywhere
 *      in the tree.
 *
 * Originally DEV_BASELINE was 29 (exact, dev-only Vercel-CLI pins — tar,
 * undici, js-yaml, … — tracked upstream in vercel/vercel#11543). They were
 * eliminated via the `overrides` block in package.json (which forces patched
 * lines for the vulnerable transitive deps). The baseline is therefore 0 now:
 * any single vulnerability fails the build. Deliberately raising the baseline
 * requires updating DEV_BASELINE here *and* the documentation.
 */
import { execSync } from 'node:child_process';

const DEV_BASELINE = 0;

/** Runs `npm audit --json <args>` and returns the parsed report (null on failure). */
function runAudit(args) {
  try {
    return JSON.parse(execSync(`npm audit --json ${args}`, { encoding: 'utf8' }));
  } catch (e) {
    // npm audit exits non-zero when it finds vulnerabilities; the JSON is on stdout.
    try {
      return JSON.parse(e.stdout || '');
    } catch {
      return null;
    }
  }
}

const summaryOf = (m = {}) =>
  `info:${m.info ?? 0} low:${m.low ?? 0} moderate:${m.moderate ?? 0} high:${m.high ?? 0} critical:${m.critical ?? 0}`;

// ─── 1. Production gate — nothing vulnerable ships to users ───────────────
const prod = runAudit('--omit=dev');
const prodVulns = prod ? Object.values(prod.vulnerabilities || {}).filter((v) => v.severity !== 'info') : [];
if (prodVulns.length > 0) {
  const names = prodVulns.map((v) => `${v.name} (${v.severity})`).join(', ');
  console.error(`❌ Production audit FAILED — ${prodVulns.length} vulnerable runtime package(s): ${names}`);
  process.exit(1);
}
console.log('✅ Production (--omit=dev) audit clean — no runtime vulnerabilities.');

// ─── 2. Total regression gate — count must stay within the documented baseline ──
const all = runAudit('');
const total = all?.metadata?.vulnerabilities?.total ?? 0;
if (total > DEV_BASELINE) {
  console.error(
    `❌ Total vulnerabilities (${total}) exceed the documented dev-only baseline (${DEV_BASELINE}).`
  );
  console.error('   A new vulnerability appeared in the dependency tree.');
  console.error('   Investigate it before raising the baseline (update DEV_BASELINE here + DEVELOPMENT_HISTORY.md).');
  process.exit(1);
}
console.log(
  `✅ Total audit count ${total} within dev-only baseline ${DEV_BASELINE} ` +
    `(${summaryOf(all?.metadata?.vulnerabilities)}).`
);
if (total < DEV_BASELINE) {
  console.log(`   ${DEV_BASELINE - total} vulnerability(ies) fixed since the baseline was set.`);
}