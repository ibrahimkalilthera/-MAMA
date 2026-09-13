#!/usr/bin/env node
/**
 * Quality chain runner — async, watchdog-protected.
 *
 * The full chain (lint → l10n → tests → build) in a SINGLE node process,
 * designed against the three failure modes that historically wedged this
 * machine (msys fork panic, documented in DEVELOPMENT_HISTORY.md):
 *
 *   1. EVENT-LOOP LAG — nothing here is synchronous: every step is spawned
 *      with `child_process.spawn` (async, piped) and awaited; no execSync,
 *      no fs.readFileSync. The parent never blocks, so a stuck step cannot
 *      freeze the runner itself.
 *
 *   2. UNHANDLED ERRORS — `unhandledRejection` / `uncaughtException` are
 *      caught globally and converted into a visible error + exit code 1
 *      instead of a silent process death mid-chain.
 *
 *   3. MEMORY — every step logs RSS/heap; the test step (which runs the
 *      TypeScript-AST contrast scan over src/) is spawned with
 *      --max-old-space-size=4096 so the compiler never hits
 *      "Ineffective mark-compacts near limit".
 *
 *   4. WATCHDOG (the fork-panic prevention) — each step has a hard timeout;
 *      on expiry the whole child TREE is killed (`taskkill /T /F` on
 *      Windows, process-group SIGKILL elsewhere). The documented trigger of
 *      the msys panic is an ORPHANED node.exe left by a timed-out run — a
 *      full tree kill leaves nothing behind.
 *
 *   5. ORPHAN HYGIENE (root cause) — this chain must never seed the next
 *      panic: it sweeps orphaned Chrome/Electron before the first step,
 *      starts a DETACHED guard (scripts/lib/orphan-guard.mjs) that outlives
 *      it so an EXTERNAL kill still gets its leftovers swept, and purges the
 *      node.exe processes it created on EVERY exit path (normal end,
 *      failure, Ctrl-C/SIGTERM) — identified by LINEAGE (descendants of this
 *      pid), not by command line: the chain's real workload is
 *      `with-pinned-node.mjs` → `check-*.mjs` → eslint/tsc/stylelint, none of
 *      which a command-line filter recognises. See ./lib/orphan-node.mjs.
 *      (Lineage only closes while the root lives, which is why the guard
 *      RECORDS descendants while the chain runs instead of closing over a dead
 *      pid afterwards — measured, see that module's header.)
 *
 *   6. NO PATH, NO npm — the steps' commands are RESOLVED EXPLICITLY instead
 *      of being looked up. `npm run <script>` spawns a shell, the shell reads
 *      PATH to find `node`, `eslint`, `tsc` and `stylelint`, and the pin then
 *      depends on the ORDER of PATH (which is why `node_modules/.bin` carries
 *      node/npm/npx wrappers at all, ./lib/bin-shims.mjs). Here a package.json
 *      script is split into links and each link becomes an explicit argv for
 *      THIS node — the one the launcher pinned: `node <abs>/eslint/bin/eslint.js`,
 *      never a bare `eslint`. Three node processes per step disappear with it
 *      (npm → shell → tool), which matters on this machine, where every extra
 *      node.exe loads the msys fork table (docs/FORK_PANIC.md). A link that
 *      cannot be resolved explicitly FAILS the step — it is never handed to
 *      PATH, because that is the dependency this removes.
 *
 * Usage:  node scripts/quality-chain.mjs           (all steps)
 *         node scripts/quality-chain.mjs lint test  (selected steps)
 *
 * The pre-commit hook runs `lint test audit` — the same async/watchdog
 * machinery, so a git commit can never wedge the msys fork table the way
 * the old `execSync('npm run lint && npm test && …', {shell:true})` line
 * could (DEVELOPMENT_HISTORY.md, “msys fork panic”).
 */
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveScript } from './lib/chain-links.mjs';
import {
  formatTimingReport,
  parallelPlan,
  previousSteps,
  readTimings,
  summarizeTimings,
  writeTimings,
} from './lib/chain-timings.mjs';
import { sweepOrphanElectron, sweepOrphanPuppeteer } from './lib/orphan-chrome.mjs';
import { spawnOrphanGuard } from './lib/orphan-guard.mjs';
import { recordSweep, sweepOwnNodeOrphans } from './lib/orphan-node.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Global error handlers: a rejected promise must never kill the chain
// ── silently (and must never leave a zombie child behind).
process.on('unhandledRejection', (reason) => {
  console.error(`\n❌ unhandledRejection: ${reason instanceof Error ? reason.stack : reason}`);
  process.exitCode = 1;
});
process.on('uncaughtException', (err) => {
  console.error(`\n❌ uncaughtException: ${err instanceof Error ? err.stack : err}`);
  process.exitCode = 1;
});

const win32 = process.platform === 'win32';

// Every link that costs wall-clock time lands here — the steps, but also the
// hygiene that runs around them (the sweeps before the first step, the purge on
// the way out): on this machine those are seconds of `node.exe`/powershell work,
// and a link that is not measured is a link nobody can decide about.
const timings = [];

/**
 * Purge the node.exe processes THIS run created — BY LINEAGE, never by command
 * line. The former selective filter recognised the `npm-cli.js run …` wrapper
 * but none of the processes doing the actual work (`with-pinned-node.mjs`, the
 * check-* guards, eslint, tsc, stylelint, the tsx test workers), so a kill that
 * does not take the tree with it (agent/CI timeout, OOM) left the whole
 * workload behind — precisely the orphans that hold the msys fork table.
 *
 * Runs on EVERY exit path and records its result (./lib/orphan-node.mjs), so
 * the panic's real frequency becomes measurable. Idempotent: first call wins.
 */
let purgeStarted = false;
async function purgeOwnOrphans(origin) {
  if (purgeStarted) return { killed: 0, passes: 0 };
  purgeStarted = true;
  const started = Date.now();
  const result = await sweepOwnNodeOrphans({
    rootPids: [process.pid], // still alive here, so the closure is still valid
    excludePid: process.pid,
    log: (m) => console.log(m),
  });
  timings.push({ name: `purge:${origin}`, ok: true, ms: Date.now() - started });
  recordSweep({ origin, ...result });
  return result;
}

// Ctrl-C / kill: purge the step children we are about to abandon before
// leaving, so an interrupted run does not seed the next fork panic.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    purgeOwnOrphans(`signal:${signal}`).finally(() => process.exit(130));
  });
}

function memMb() {
  const m = process.memoryUsage();
  return `rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`;
}

/** Hard-kill the whole child tree (never leave an orphaned node.exe). */
function killTree(pid) {
  try {
    if (win32) {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
}

/**
 * Run one chain step. `args` is passed to the current node executable
 * (spawn, NOT a shell string — no bash involvement, nothing to wedge).
 */
function runStep(name, args, { timeoutMs = 300000, nodeOpts } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, ...(nodeOpts ? { NODE_OPTIONS: nodeOpts } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));

    const timer = setTimeout(() => {
      console.error(`\n⏱  ${name} dépassé (${timeoutMs}ms) — kill de tout l'arbre ${child.pid}`);
      killTree(child.pid);
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      console.error(`❌ ${name}: ${err.message}`);
      resolve({ name, ok: false, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      console.log(`\n— ${name}: ${code === 0 ? 'OK' : `exit ${code}`} en ${Date.now() - started}ms [${memMb()}]`);
      resolve({ name, ok: code === 0, ms: Date.now() - started });
    });
  });
}

// ── Scripts, resolved EXPLICITLY — no npm, no shell, no PATH lookup ─────────
// Each link of a package.json script becomes an explicit argv for THIS node
// (`process.execPath`, the runtime the launcher pinned), with the tool's entry
// read from the installed package's own `bin` field — the same declaration
// npm's wrappers are generated from, so the explicit path and the path npm
// would have used are the same file. See ./lib/chain-links.mjs.
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

/**
 * Run a package.json script link by link, explicitly.
 *
 * The per-link progress lines name the link (`lint:eslint`), so a slow step can
 * be attributed without reading the script; the measured timing stays ONE row
 * per step, because that is the unit the report compares across runs.
 * `timeoutMs` is per LINK: a wedged link is killed tree-wide and named instead
 * of taking the thirteen healthy ones down with it.
 */
async function runScript(name, scriptName, { timeoutMs = 300000, nodeOpts } = {}) {
  const started = Date.now();
  let plan;
  try {
    plan = resolveScript(pkg.scripts?.[scriptName], { root });
  } catch (error) {
    console.error(`❌ ${name} : ${error instanceof Error ? error.message : error}`);
    return { name, ok: false, ms: Date.now() - started };
  }
  for (const link of plan.links) {
    // A single-link step keeps its own name (`tests`, `build`); the link prefix
    // is for the many-link ones, where attributing the cost is the whole point.
    const label = plan.links.length > 1 ? `${name}:${link.label}` : name;
    const result = await runStep(label, link.args, { timeoutMs, nodeOpts });
    if (!result.ok) return { name, ok: false, ms: Date.now() - started };
  }
  return { name, ok: true, ms: Date.now() - started };
}

const STEPS = {
  // `lint` is the chain's public entry (`npm run lint` → with-pinned-node →
  // lint:chain); here the links themselves run, resolved explicitly.
  lint: () => runScript('lint', 'lint:chain', { timeoutMs: 300000 }),
  l10n: () => runStep('l10n-verify', ['scripts/l10n-verify.mjs'], { timeoutMs: 60000 }),
  test: () =>
    runScript('tests', 'test', {
      timeoutMs: 600000,
      nodeOpts: '--max-old-space-size=4096',
    }),
  build: () => runScript('build', 'build', { timeoutMs: 180000 }),
  // Security gate (scripts/check-audit.mjs). Env-neutral here: the caller
  // decides AUDIT_CACHE / AUDIT_SOFT_OFFLINE — the pre-commit hook sets
  // both (cache + soft-offline), CI keeps it strict by calling the script
  // directly without them.
  audit: () => runStep('audit-gate', ['scripts/check-audit.mjs'], { timeoutMs: 600000 }),
  // L'atelier `release/` ne peut plus regrossir en silence : dès qu'un fichier y
  // est PROUVÉ redondant (le canal sert déjà ces octets exacts), ce maillon sort
  // en échec. Il ne supprime rien — l'acte reste humain — mais plus aucun commit
  // ne peut se faire en laissant l'atelier mentir. Hors ligne, il se tait en le
  // DISANT (WORKSHOP_SOFT_OFFLINE=1, comme le gate d'audit) : le hook ne doit pas
  // dépendre du réseau, la CI si.
  workshop: () => runStep('workshop', ['scripts/prune-release-dir.mjs', '--check'], { timeoutMs: 180000 }),
};

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted.filter((n) => n in STEPS) : Object.keys(STEPS);

// Sweep orphan Chrome from interrupted verify runs — a watchdog timeout kills
// the step's whole tree, but a puppeteer Chrome wedged mid-run survives and
// accumulates (the exact pile-up that saturates the msys fork table). Sweep
// before the first step, while the machine is still quiet.
const sweepChromeStart = Date.now();
const swept = await sweepOrphanPuppeteer();
timings.push({ name: 'sweep:chrome', ok: true, ms: Date.now() - sweepChromeStart });
if (swept > 0) console.log(`🧹 ${swept} processus Chrome orphelin(s) purgé(s)`);

// Same sweep for the packaged app: verify-desktop-app / verify-updater runs
// launch MamaTheraFinance.exe with the electron-proof-ud marker (killed
// regardless of age); a legitimately open instance is only touched past the
// 5-minute window, so a fresh app the user just opened is never harmed.
const sweepElectronStart = Date.now();
const sweptElectron = await sweepOrphanElectron();
timings.push({ name: 'sweep:electron', ok: true, ms: Date.now() - sweepElectronStart });
if (sweptElectron > 0) console.log(`🧹 ${sweptElectron} processus MamaTheraFinance.exe orphelin(s) purgé(s)`);

// Own-orphan hygiene: start the DETACHED guard (double-spawned out of this
// process tree), which outlives us and sweeps our node.exe orphans even when
// we are killed from OUTSIDE (tool/CI timeout, taskkill /T) before the
// end-of-run sweep below can run.
spawnOrphanGuard({ parentPid: process.pid });

console.log(`🚀 Chaîne qualité — ${names.join(' → ')}  [${memMb()}]  (pid ${process.pid})`);
const results = [];
try {
  for (const name of names) {
    if (process.exitCode) break; // a global handler already failed us
    results.push(await STEPS[name]());
  }
} finally {
  // Own-orphan hygiene on EVERY exit path — normal end, step failure, or a
  // throw — so a run never leaves a step child behind. (The detached guard
  // covers the one path we cannot reach: a kill from outside.)
  await purgeOwnOrphans('exit');
}

// Where the time went, and what parallelising would buy — printed for every
// run, so "this commit felt slow" becomes a number with a name on it. The
// previous run comes from the cache, hence the read BEFORE the write.
const previous = previousSteps(readTimings({ root }));
const summary = summarizeTimings(
  [...timings, ...results],
  { previous },
);
for (const line of formatTimingReport(summary, { parallel: parallelPlan(summary.rows) })) {
  console.log(line);
}
writeTimings({
  at: new Date().toISOString(),
  totalMs: summary.totalMs,
  steps: summary.rows.map((r) => ({ name: r.name, ms: r.ms, ok: r.ok })),
}, { root });

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} étape(s) en échec : ${failed.map((f) => f.name).join(', ')}`);
  // process.exitCode (not process.exit): the finally above must still run.
  process.exitCode = 1;
} else {
  console.log(`\n✅ Chaîne qualité complète — ${results.length} étapes vertes.`);
}