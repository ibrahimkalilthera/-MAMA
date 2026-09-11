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
 * Usage:  node scripts/quality-chain.mjs           (all steps)
 *         node scripts/quality-chain.mjs lint test  (selected steps)
 *
 * The pre-commit hook runs `lint test audit` — the same async/watchdog
 * machinery, so a git commit can never wedge the msys fork table the way
 * the old `execSync('npm run lint && npm test && …', {shell:true})` line
 * could (DEVELOPMENT_HISTORY.md, “msys fork panic”).
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveNpmCliJs } from './lib/npm-cli.mjs';
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
  const result = await sweepOwnNodeOrphans({
    rootPids: [process.pid], // still alive here, so the closure is still valid
    excludePid: process.pid,
    log: (m) => console.log(m),
  });
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

// Spawn npm through its JS entry (node npm-cli.js) instead of npm.cmd — the
// shared resolver lives in ./lib/npm-cli.mjs, because the runtime launcher
// (./with-pinned-node.mjs) needs exactly the same rule to run npm under the
// PINNED node rather than the one that started us.
const npmCliJs = resolveNpmCliJs(process.execPath);

const runNpm = (name, script, opts) =>
  new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [npmCliJs, 'run', script], {
      cwd: root,
      env: { ...process.env, ...(opts?.nodeOpts ? { NODE_OPTIONS: opts.nodeOpts } : {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (d) => process.stdout.write(d));
    child.stderr.on('data', (d) => process.stderr.write(d));
    const timer = setTimeout(() => {
      console.error(`\n⏱  ${name} dépassé (${opts?.timeoutMs ?? 300000}ms) — kill de tout l'arbre ${child.pid}`);
      killTree(child.pid);
    }, opts?.timeoutMs ?? 300000);
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

const STEPS = {
  lint: () => runNpm('lint', 'lint', { timeoutMs: 300000 }),
  l10n: () => runStep('l10n-verify', ['scripts/l10n-verify.mjs'], { timeoutMs: 60000 }),
  test: () =>
    runNpm('tests', 'test', {
      timeoutMs: 600000,
      nodeOpts: '--max-old-space-size=4096',
    }),
  build: () => runNpm('build', 'build', { timeoutMs: 180000 }),
  // Security gate (scripts/check-audit.mjs). Env-neutral here: the caller
  // decides AUDIT_CACHE / AUDIT_SOFT_OFFLINE — the pre-commit hook sets
  // both (cache + soft-offline), CI keeps it strict by calling the script
  // directly without them.
  audit: () => runStep('audit-gate', ['scripts/check-audit.mjs'], { timeoutMs: 600000 }),
};

const wanted = process.argv.slice(2);
const names = wanted.length > 0 ? wanted.filter((n) => n in STEPS) : Object.keys(STEPS);

// Sweep orphan Chrome from interrupted verify runs — a watchdog timeout kills
// the step's whole tree, but a puppeteer Chrome wedged mid-run survives and
// accumulates (the exact pile-up that saturates the msys fork table). Sweep
// before the first step, while the machine is still quiet.
const swept = await sweepOrphanPuppeteer();
if (swept > 0) console.log(`🧹 ${swept} processus Chrome orphelin(s) purgé(s)`);

// Same sweep for the packaged app: verify-desktop-app / verify-updater runs
// launch MamaTheraFinance.exe with the electron-proof-ud marker (killed
// regardless of age); a legitimately open instance is only touched past the
// 5-minute window, so a fresh app the user just opened is never harmed.
const sweptElectron = await sweepOrphanElectron();
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

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} étape(s) en échec : ${failed.map((f) => f.name).join(', ')}`);
  // process.exitCode (not process.exit): the finally above must still run.
  process.exitCode = 1;
} else {
  console.log(`\n✅ Chaîne qualité complète — ${results.length} étapes vertes.`);
}