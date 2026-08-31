/**
 * Weekly watch on the isolated Vercel CLI (tools/).
 *
 * `tools/` keeps the vercel CLI out of the root lockfile on purpose: its
 * dev-only dependency tree still carries the vulnerable transitive pins
 * (tar, undici, js-yaml, minimatch, smol-toml, path-to-regexp, …) tracked
 * upstream in vercel/vercel#11543. Dependabot already opens the bump PR in
 * tools/ whenever a new CLI ships (daily schedule) — what it cannot tell us
 * is whether the NEW tree is actually clean. This watch adds exactly that:
 *
 *   1. audit the CURRENT tools/ tree from its lockfile (no install needed);
 *   2. resolve the LATEST vercel release and audit that tree the same way
 *      (`npm install --package-lock-only` in a temp dir — metadata only);
 *   3. when the latest tree audits 0 (the pins fix is available), open a
 *      SINGLE tracking issue, refresh it weekly with live numbers, link any
 *      open Dependabot bump PR, and auto-close it once tools/ actually
 *      audits 0 after the bump is merged.
 *
 * Exit codes: this is a TRACKER, not a gate — an still-vulnerable upstream
 * must NOT turn the run red (the pins are dev-only and never bundled, see
 * DEVELOPMENT_HISTORY.md). Only infrastructural failures (registry
 * unreachable, lockfile unparseable, npm broken) exit non-zero.
 *
 * Modes:
 *   • CI (GITHUB_TOKEN set): full issue lifecycle (create / refresh / close).
 *   • local (no token): read-only dry run — prints the report, touches nothing.
 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const SPAWN_OPTS = { shell: process.platform === 'win32' };
const REPO = process.env.GITHUB_REPOSITORY || 'ibrahimkalilthera/-MAMA';
const TOKEN = process.env.GITHUB_TOKEN || '';
const LABEL = 'vercel-pins';
const ISSUE_TITLE = 'Vercel CLI: the pins fix is available — bump tools/ (vercel/vercel#11543)';
const API = 'https://api.github.com';
const UPSTREAM_ISSUE = 'https://github.com/vercel/vercel/issues/11543';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const info = (msg) => console.log('• ' + msg);
function fail(msg) {
  console.error('✖ ' + msg);
  process.exit(1);
}

// ─── npm plumbing ────────────────────────────────────────────────────────────

/** Read the pinned vercel version from tools/package.json ('^59.10.0' → '59.10.0'). */
function readPinnedVersion() {
  const pkg = JSON.parse(readFileSync('tools/package.json', 'utf8'));
  const range = (pkg.dependencies && pkg.dependencies.vercel) || (pkg.devDependencies && pkg.devDependencies.vercel);
  if (!range) fail('tools/package.json declares no vercel dependency');
  return range.replace(/^[^\d]*/, '');
}

/**
 * Latest published vercel version, via `npm view` (npm's own transport —
 * more robust here than a bare fetch, which may bypass proxy settings).
 * Returns null when the registry is unreachable after retries.
 */
async function fetchLatestVersion() {
  for (let i = 0; i < 4; i++) {
    const r = spawnSync(NPM, ['view', 'vercel', 'version'], { encoding: 'utf8', ...SPAWN_OPTS });
    if (r.status === 0 && r.stdout) {
      const version = r.stdout.trim();
      if (/^\d+\.\d+\.\d+/.test(version)) return version;
    }
    info(`npm view attempt ${i + 1} failed — retrying`);
    await sleep(3000);
  }
  return null;
}

/** Total vulnerabilities of the lockfile tree in `dir` — no install needed. */
function auditTree(dir) {
  const r = spawnSync(NPM, ['audit', '--json'], { cwd: dir, encoding: 'utf8', ...SPAWN_OPTS });
  if (!r.stdout) return null;
  try {
    const data = JSON.parse(r.stdout);
    const total = data.metadata && data.metadata.vulnerabilities && data.metadata.vulnerabilities.total;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the dependency tree of vercel@<version> into a throwaway lockfile
 * (metadata only — nothing is downloaded or executed) and audit it.
 * Returns the vulnerability total, or null when the resolution failed.
 */
function probeTree(version) {
  const dir = mkdtempSync(join(tmpdir(), 'vercel-pins-probe-'));
  try {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'vercel-pins-probe', version: '0.0.0', dependencies: { vercel: version } }, null, 2),
    );
    const install = spawnSync(
      NPM,
      ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
      { cwd: dir, encoding: 'utf8', ...SPAWN_OPTS },
    );
    if (install.status !== 0) return null;
    return auditTree(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const delta = (pa[i] || 0) - (pb[i] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

// ─── GitHub REST (issues only; read-only when TOKEN is empty) ────────────────

async function gh(path, init = {}, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(API + path, {
        ...init,
        headers: {
          'User-Agent': 'vercel-pins-watch',
          Accept: 'application/vnd.github+json',
          ...(TOKEN ? { Authorization: 'Bearer ' + TOKEN } : {}),
          ...(init.headers || {}),
        },
      });
      if (res.ok) return res.status === 204 ? null : await res.json();
      if (res.status === 404) return null;
    } catch {
      // network hiccup — retry
    }
    await sleep(2000);
  }
  return null;
}

/** The open, non-PR issue carrying the vercel-pins label (our single tracker). */
async function findTrackingIssue() {
  const issues = await gh(`/repos/${REPO}/issues?state=open&per_page=100`);
  if (!Array.isArray(issues)) return null;
  return (
    issues.find(
      (i) => !i.pull_request && (i.labels || []).some((l) => (typeof l === 'string' ? l : l.name) === LABEL),
    ) || null
  );
}

/** Open Dependabot PRs bumping vercel inside tools/. */
async function listDependabotVercelPRs() {
  const prs = await gh(`/repos/${REPO}/pulls?state=open&per_page=100`);
  if (!Array.isArray(prs)) return [];
  return prs.filter((p) => {
    const ref = (p.head && p.head.ref) || '';
    return ref.startsWith('dependabot/') && (ref.includes('/tools/') || /vercel/i.test(p.title || ''));
  });
}

function createIssue(body) {
  return gh(`/repos/${REPO}/issues`, {
    method: 'POST',
    body: JSON.stringify({ title: ISSUE_TITLE, body, labels: [LABEL] }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function updateIssue(number, body) {
  return gh(`/repos/${REPO}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function commentOnIssue(number, body) {
  return gh(`/repos/${REPO}/issues/${number}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
    headers: { 'Content-Type': 'application/json' },
  });
}

function closeIssue(number) {
  return gh(`/repos/${REPO}/issues/${number}`, {
    method: 'PATCH',
    body: JSON.stringify({ state: 'closed' }),
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Report ──────────────────────────────────────────────────────────────────

function buildBody({ checkedAt, pinned, latest, currentCount, latestCount, fixAvailable, prs }) {
  const prLines = prs.length
    ? prs.map((p) => `- [${p.title}](${p.html_url})`).join('\n')
    : '- none open yet — Dependabot (daily schedule on `/tools`) should open one within a day of the release';
  return [
    '## Vercel CLI pins — upstream fix status',
    '',
    `**Last checked:** ${checkedAt} (weekly watch, \`.github/workflows/vercel-pins-watch.yml\`)`,
    '',
    '| tree | vercel version | vulnerable pins |',
    '|---|---|---|',
    `| current \`tools/\` | ${pinned} | **${currentCount}** |`,
    latestCount === null
      ? `| latest release | ${latest} | same as current — \`tools/\` is up to date |`
      : `| latest release | ${latest} | ${latestCount} |`,
    '',
    fixAvailable
      ? `✅ **Verdict:** \`vercel@${latest}\` resolves a clean tree — the pins fix is AVAILABLE.`
      : `⏳ **Verdict:** the latest tree still carries ${latestCount === null ? currentCount : latestCount} vulnerabilities — fix not available yet (upstream: ${UPSTREAM_ISSUE}).`,
    '',
    '### Open Dependabot bump PR(s) for tools/',
    prLines,
    '',
    '### How to apply once the fix is available',
    '1. Merge the Dependabot PR above (it bumps `tools/package.json` + its lockfile), or bump manually:',
    '   ```bash',
    `   cd tools && npm install vercel@${latest} && npm audit   # expect 0`,
    '   ```',
    '2. The root project stays untouched — these pins are deploy-CLI-only, never bundled into the app (see DEVELOPMENT_HISTORY.md).',
    '3. This issue auto-closes on the next weekly run once `tools/` audits **0**.',
    '',
    `_Context: the CLI lives in [tools/](tools/package.json) precisely so these dev-only pins never reach the root lockfile or the bundle. Upstream tracking: ${UPSTREAM_ISSUE}._`,
  ].join('\n');
}

function writeSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  try {
    appendFileSync(summaryPath, markdown + '\n');
  } catch {
    // a failed summary write must never fail the run
  }
}

// ─── Dev escape hatch ────────────────────────────────────────────────────────
// PROBE_VERSION=59.10.0 node scripts/check-vercel-pins.mjs exercises the
// latest-tree probe path without waiting for a new upstream release.
if (process.env.PROBE_VERSION) {
  const count = probeTree(process.env.PROBE_VERSION);
  console.log(`probe vercel@${process.env.PROBE_VERSION} → ${count === null ? 'resolution failed' : count + ' vulnerabilities'}`);
  process.exit(count === null ? 1 : 0);
}

// ─── Main ────────────────────────────────────────────────────────────────────

(async () => {
  const pinned = readPinnedVersion();
  const latest = await fetchLatestVersion();
  if (!latest) fail('could not read the latest vercel version (registry unreachable)');

  const currentCount = auditTree('tools');
  if (currentCount === null) fail('could not audit the current tools/ tree (lockfile unreadable?)');

  const isNew = compareVersions(latest, pinned) > 0;
  let latestCount = null;
  let fixAvailable = false;
  if (isNew) {
    latestCount = probeTree(latest);
    if (latestCount === null) fail(`could not probe the dependency tree of vercel@${latest}`);
    fixAvailable = latestCount === 0;
  }

  const checkedAt = new Date().toISOString();
  const verdict = fixAvailable
    ? `FIX AVAILABLE — vercel@${latest} audits ${latestCount} (clean); current tools/ (${pinned}) audits ${currentCount}`
    : isNew
      ? `no fix yet — vercel@${latest} audits ${latestCount}; current tools/ (${pinned}) audits ${currentCount}`
      : `up to date — vercel@${latest} == pinned ${pinned}; tools/ audits ${currentCount}`;
  info(verdict);

  const report = buildBody({ checkedAt, pinned, latest, currentCount, latestCount, fixAvailable, prs: [] });
  writeSummary(
    ['## Vercel pins watch', '', '```', verdict, '```', '', 'Full report is written to the tracking issue when a fix is available.'].join('\n'),
  );

  if (!TOKEN) {
    info('no GITHUB_TOKEN — dry run: issue state untouched');
    return;
  }

  // ── Issue lifecycle ──
  if (currentCount === 0) {
    // tools/ is clean (fix landed and applied) → close any open tracker.
    const issue = await findTrackingIssue();
    if (issue) {
      await commentOnIssue(issue.number, `✅ \`tools/\` now audits **0** vulnerabilities with vercel \`${pinned}\` (checked ${checkedAt}). The pins fix landed and is applied — closing this tracker.`);
      await closeIssue(issue.number);
      info(`closed tracking issue #${issue.number}`);
    } else {
      info('tools/ tree is clean — no open tracker to close');
    }
    return;
  }

  const prs = await listDependabotVercelPRs();
  const body = buildBody({ checkedAt, pinned, latest, currentCount, latestCount, fixAvailable, prs });
  const issue = await findTrackingIssue();

  if (issue) {
    await updateIssue(issue.number, body);
    info(`refreshed tracking issue #${issue.number}`);
    return;
  }

  if (fixAvailable) {
    const created = await createIssue(body);
    if (created && created.number) info(`created tracking issue #${created.number}`);
    else fail('could not create the tracking issue');
    return;
  }

  info('no fix available yet — no tracking issue needed; CI summary carries the status');
})().catch((err) => fail(err && err.message ? err.message : String(err)));
