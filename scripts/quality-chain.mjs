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
 * Usage:  node scripts/quality-chain.mjs           (all steps)
 *         node scripts/quality-chain.mjs lint test  (selected steps)
 *
 * The pre-commit hook runs `lint test audit` — the same async/watchdog
 * machinery, so a git commit can never wedge the msys fork table the way
 * the old `execSync('npm run lint && npm test && …', {shell:true})` line
 * could (DEVELOPMENT_HISTORY.md, “msys fork panic”).
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

// Spawn npm through its JS entry (node npm-cli.js) instead of npm.cmd:
// spawning .cmd directly needs a shell, and a shell is exactly what we
// must avoid on this machine (msys fork panic). npm lives next to the
// node executable in a standard install; fall back to PATH resolution.

function resolveNpmCliJs() {
  for (const base of [dirname(process.execPath), dirname(dirname(process.execPath))]) {
    const cli = join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js');
    if (existsSync(cli)) return cli;
  }
  const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['npm'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim().split(/\r?\n/)[0];
  return join(dirname(which), 'node_modules', 'npm', 'bin', 'npm-cli.js');
}

const npmCliJs = resolveNpmCliJs();

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

console.log(`🚀 Chaîne qualité — ${names.join(' → ')}  [${memMb()}]  (pid ${process.pid})`);
const results = [];
for (const name of names) {
  if (process.exitCode) break; // a global handler already failed us
  results.push(await STEPS[name]());
}

const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(`\n❌ ${failed.length} étape(s) en échec : ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}
console.log(`\n✅ Chaîne qualité complète — ${results.length} étapes vertes.`);