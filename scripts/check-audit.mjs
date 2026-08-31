/**
 * Security gate — blocks reintroduced vulnerabilities before they can ship.
 *
 * Runs in two places with the same two gates:
 *   • CI (perf-guard.yml, `quality` job): strict — any failure blocks the push.
 *   • The husky pre-commit hook (invoked with AUDIT_CACHE=1 AUDIT_SOFT_OFFLINE=1):
 *     same gates, but the result is cached against the lockfile hash so commits
 *     that don't touch dependencies are instant, and an unreachable registry
 *     (offline development) only warns — the CI push gate stays the
 *     enforcement point.
 *
 * Fails when any of these holds:
 *   1. ANY production/runtime dependency has a known vulnerability
 *      (`npm audit --omit=dev` non-empty) — nothing vulnerable may ship.
 *   2. The total vulnerability count exceeds the documented baseline
 *      (DEV_BASELINE = 0) — i.e. a brand-new vulnerability appears anywhere
 *      in the tree.
 *   3. (CI only) the registry is unreachable and the audit cannot run —
 *      an unverifiable dependency tree must not pass silently.
 *
 * Originally DEV_BASELINE was 29 (exact, dev-only Vercel-CLI pins — tar,
 * undici, js-yaml, … — tracked upstream in vercel/vercel#11543). They left the
 * root lockfile entirely when the vercel CLI moved to the isolated tools/
 * manifest (deployed via GitHub Actions). The baseline is 0 now: any single
 * vulnerability fails the gate. Deliberately raising it requires updating
 * DEV_BASELINE here *and* DEVELOPMENT_HISTORY.md.
 *
 * Cache (AUDIT_CACHE=1): `node_modules/.cache/audit-gate.json`, keyed on the
 * sha256 of package-lock.json, valid for AUDIT_CACHE_TTL_HOURS (default 24).
 * AUDIT_CACHE_REFRESH=1 forces a live re-audit (the fresh result is re-cached).
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DEV_BASELINE = 0;
const CACHED = process.env.AUDIT_CACHE === '1';
const SOFT_OFFLINE = process.env.AUDIT_SOFT_OFFLINE === '1';
const FORCE_REFRESH = process.env.AUDIT_CACHE_REFRESH === '1';
const TTL_MS = (Number(process.env.AUDIT_CACHE_TTL_HOURS) || 24) * 60 * 60 * 1000;
const CACHE_FILE = path.resolve('node_modules/.cache/audit-gate.json');

/** Runs `npm audit --json <args>` and returns the parsed report (null if it could not run). */
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

/** Stable identity of the dependency tree: sha256 of the lockfile (the audit's input). */
function lockHash() {
  try {
    return createHash('sha256').update(fs.readFileSync('package-lock.json')).digest('hex').slice(0, 16);
  } catch {
    return 'no-lockfile';
  }
}

function readCache(hash) {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    if (c?.version !== 1 || c?.lockHash !== hash) return null;
    const age = Date.now() - Date.parse(c.checkedAt);
    if (!Number.isFinite(age) || age < 0 || age > TTL_MS) return null;
    return c;
  } catch {
    return null;
  }
}

function writeCache(hash, prodVulns, total, summary) {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ version: 1, lockHash: hash, checkedAt: new Date().toISOString(), prodVulns, total, summary }, null, 2)
    );
  } catch (e) {
    // Best-effort only: a cache failure must never fail the gate.
    console.warn(`⚠️  Could not write the audit cache (${e.message}).`);
  }
}

// ─── Gates (shared by live and cached results) ──────────────────────────────

function enforceProductionGate(prodVulns, source) {
  if (prodVulns.length > 0) {
    const names = prodVulns.map((v) => `${v.name} (${v.severity})`).join(', ');
    console.error(`❌ Production audit FAILED ${source}— ${prodVulns.length} vulnerable runtime package(s): ${names}`);
    process.exit(1);
  }
  console.log(`✅ Production (--omit=dev) audit clean — no runtime vulnerabilities. ${source}`);
}

function enforceTotalGate(total, summary, source) {
  if (total > DEV_BASELINE) {
    console.error(`❌ Total vulnerabilities (${total}) exceed the documented baseline (${DEV_BASELINE}). ${source}`);
    console.error('   A new vulnerability appeared in the dependency tree.');
    console.error('   Investigate it before raising the baseline (update DEV_BASELINE here + DEVELOPMENT_HISTORY.md).');
    process.exit(1);
  }
  console.log(`✅ Total audit count ${total} within baseline ${DEV_BASELINE} (${summary}). ${source}`);
  if (total < DEV_BASELINE) {
    console.log(`   ${DEV_BASELINE - total} vulnerability(ies) fixed since the baseline was set.`);
  }
}

function unreachable() {
  if (SOFT_OFFLINE) {
    console.warn('⚠️  npm audit could not run (registry unreachable or report unreadable).');
    console.warn('   Gate skipped for this offline commit — the CI quality job re-checks on push.');
    return;
  }
  console.error('❌ npm audit could not run (registry unreachable or report unreadable).');
  console.error('   An unverifiable dependency tree must not pass the security gate.');
  process.exit(1);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

const hash = lockHash();
const cache = CACHED && !FORCE_REFRESH ? readCache(hash) : null;

if (cache) {
  const ageH = ((Date.now() - Date.parse(cache.checkedAt)) / 3600000).toFixed(1);
  const source = `(cached, ${ageH}h old)`;
  enforceProductionGate(cache.prodVulns ?? [], source);
  enforceTotalGate(cache.total ?? 0, summaryOf(cache.summary), source);
} else {
  const prod = runAudit('--omit=dev');
  if (!prod) unreachable();
  const prodVulns = prod ? Object.values(prod.vulnerabilities || {}).filter((v) => v.severity !== 'info') : [];
  enforceProductionGate(prodVulns, '');

  const all = runAudit('');
  if (!all) unreachable();
  const total = all?.metadata?.vulnerabilities?.total ?? 0;
  if (CACHED && prod && all) writeCache(hash, prodVulns, total, all.metadata?.vulnerabilities);
  enforceTotalGate(total, summaryOf(all?.metadata?.vulnerabilities), '');
}
