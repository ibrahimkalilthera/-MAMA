#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/git-retry.mjs — run a git command (commit, push, …) with automatic
// retry against the transient msys fork panic of this machine.
//
// Context (documented in DEVELOPMENT_HISTORY.md, "msys fork-panic recovery
// procedure"): Git Bash periodically enters a state where every external
// command fails — `fork: Resource temporarily unavailable` (exit 254 for
// multi-command lines, exit 66 even for `node -e`), occasionally
// `uv_spawn: EUNKNOWN`. The trigger is an orphaned node.exe left by a hard
// timeout, and it also kills husky hooks (the hook content itself is fine —
// spawn-only watchdog — but the sh wrapper that git uses to run it dies of
// the fork bug, so `git commit`/`git push` abort with a panic exit code).
// Recovery was manual: probe, retry at the keyboard, kill orphaned node.exe.
//
// This wrapper automates the retry part, in the same spirit as
// scripts/quality-chain.mjs:
//   - SPAWN-ONLY: git is spawned through node's spawn (CreateProcess on
//     Windows), never through a bash/cmd shell string — nothing for msys to
//     fork, so the wrapper itself can never trigger or wedge on the panic.
//   - SIGNATURE-BASED RETRY: only retries when the failure IS the fork panic
//     (exit 254/66, or stderr matching the fork/resource-unavailable
//     patterns). A real git failure (hook lint error, merge conflict, …)
//     exits immediately with git's code — never masked by retries.
//   - BOUNDED + WATCHDOG: max `attempts` tries with a short backoff, and a
//     hard per-attempt timeout that kills the WHOLE child tree (taskkill /T
//     on Windows), never leaving an orphaned process behind.
//   - INTERACTIVE-SAFE: stdin/stdout are inherited (credentials, editors),
//     only stderr is captured (and forwarded) for signature detection.
//
// If retries still exhaust (persistent panic), the documented manual
// recovery remains: kill the orphaned node.exe processes (Task Manager or
// reboot), then re-run — the panic never touches working-tree content.
//
// Usage:
//   node scripts/git-retry.mjs commit -am "message"
//   node scripts/git-retry.mjs push origin main
//   node scripts/git-retry.mjs --sweep --attempts 5 --wait-ms 2000 -- push origin main
//   npm run git:retry -- commit -am "message"
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const FORK_PANIC_EXIT_CODES = new Set([254, 66]);
const FORK_PANIC_PATTERN =
  /fork:|Resource temporarily unavailable|uv_spawn|EUNKNOWN|Cannot allocate memory/i;

/**
 * True when a git failure is the transient msys fork panic rather than a
 * real git error. Exit codes 254/66 are the documented panic signatures;
 * the stderr patterns cover sh/hook crash messages under any exit code.
 */
export function isForkPanicFailure(exitCode, stderrTail = '') {
  if (FORK_PANIC_EXIT_CODES.has(exitCode)) return true;
  return FORK_PANIC_PATTERN.test(stderrTail);
}

// Only these known quality-chain command lines are eligible for the optional
// sweep. Never kill arbitrary node.exe processes: a dev server, editor helper,
// or another user's Node task is not an orphan just because git is retrying.
const NODE_ORPHAN_SWEEP_SCRIPT = (minAgeMinutes) => [
  `$cut = (Get-Date).AddMinutes(-${minAgeMinutes});`,
  `$processes = @(Get-CimInstance Win32_Process);`,
  `$all = @($processes | Where-Object { $_.Name -eq 'node.exe' });`,
  `$ids = @($processes | ForEach-Object { [int]$_.ProcessId });`,
  `$k = 0; foreach ($p in $all) { $cmd = [string]$p.CommandLine;`,
  `$known = $cmd -match 'quality-chain\\.mjs|npm-cli\\.js.*run (lint|test|audit)|--test.*tests[\\\\/].*\\.test';`,
  `$parentGone = $ids -notcontains [int]$p.ParentProcessId;`,
  `$old = ($null -ne $p.CreationDate) -and ($p.CreationDate -lt $cut);`,
  `if ($known -and ($parentGone -or $old)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $k++ } }; $k`,
].join(' ');

/**
 * Best-effort sweep of orphaned quality-chain Node processes. It is opt-in
 * because even a marker-based process sweep must never be implicit in a git
 * command. A process is eligible only when its command line belongs to the
 * quality chain/test runner AND its parent is gone or it is older than the
 * stale-age window. Returns the number killed; never rejects.
 */
export function sweepOrphanNodeProcesses({
  minAgeMinutes = 5,
  timeoutMs = 10000,
  platform = process.platform,
  log = () => {},
} = {}) {
  if (platform !== 'win32') return Promise.resolve(0);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (count) => {
      if (settled) return;
      settled = true;
      const n = Number.isFinite(count) ? count : 0;
      if (n > 0) log(`🧹 ${n} processus Node orphelin(s) de la chaîne qualité purgé(s)`);
      resolve(n);
    };
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-Command', NODE_ORPHAN_SWEEP_SCRIPT(minAgeMinutes)], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      finish(0);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      finish(0);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {
      clearTimeout(timer);
      finish(0);
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish(parseInt((out.match(/\d+/) || ['0'])[0], 10));
    });
  });
}

/** Hard-kill the whole child tree (never leave an orphaned process). */
function killTree(pid) {
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    /* already gone */
  }
}

/**
 * Run `git <args>` with bounded automatic retry on the msys fork panic.
 * Resolves with git's exit code (0 on success); never rejects.
 * @param {string[]} args
 * @param {{ attempts?: number, waitMs?: number, timeoutMs?: number,
 *   forwardStderr?: boolean, log?: (...data: unknown[]) => void,
 *   sweep?: boolean, sweepFn?: (() => unknown) }} options
 */
export function runGitWithRetry(
  args,
  /** @type {{ attempts?: number, waitMs?: number, timeoutMs?: number,
   * forwardStderr?: boolean, log?: (...data: unknown[]) => void,
   * sweep?: boolean, sweepFn?: (() => unknown) }} */
  {
    attempts = 3,
    waitMs = 5000,
    timeoutMs = 300000,
    forwardStderr = true,
    log = console.log,
    sweep = false,
    sweepFn = undefined,
  } = {},
) {
  return new Promise((resolve) => {
    let attempt = 0;
    let lastCode = 1;

    const retryOrGiveUp = (reason) => {
      if (attempt < attempts) {
        const continueRetry = () => {
          log(`↻ ${reason} — retry dans ${waitMs} ms (tentative ${attempt + 1}/${attempts})`);
          setTimeout(tryOnce, waitMs);
        };
        // The sweep happens only between attempts, never before the initial
        // command. It is best-effort and must not prevent the retry itself.
        if (sweep || sweepFn) {
          const runSweep = sweepFn || (() => sweepOrphanNodeProcesses({ log }));
          Promise.resolve().then(runSweep).then(continueRetry, continueRetry);
        } else {
          continueRetry();
        }
      } else {
        log(`❌ ${reason} persistant après ${attempt} tentative(s).`);
        log('   Récupération manuelle documentée : tuer les node.exe orphelins (Task Manager / reboot), puis relancer.');
        resolve(lastCode);
      }
    };

    function tryOnce() {
      attempt++;
      log(`⏳ git ${args.join(' ')} — tentative ${attempt}/${attempts}`);
      const child = spawn('git', args, {
        stdio: ['inherit', 'inherit', 'pipe'],
        windowsHide: true,
      });
      let stderrTail = '';
      let settled = false;
      child.stderr.on('data', (d) => {
        if (forwardStderr) process.stderr.write(d);
        stderrTail = (stderrTail + d).slice(-8192);
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        log(`⏱  dépassé (${timeoutMs} ms) — kill de tout l'arbre ${child.pid}`);
        killTree(child.pid);
        retryOrGiveUp('timeout');
      }, timeoutMs);
      child.on('error', (err) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        lastCode = 1;
        if (attempt < attempts) {
          retryOrGiveUp(`spawn impossible (${err.message})`);
        } else {
          resolve(1);
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        lastCode = code ?? 1;
        if (lastCode === 0) {
          log(`✅ git ${args[0]} OK.`);
          resolve(0);
          return;
        }
        if (isForkPanicFailure(lastCode, stderrTail)) {
          retryOrGiveUp(`fork-panic msys (exit ${lastCode})`);
        } else {
          log(`❌ git a échoué (exit ${lastCode}) — pas un fork-panic, aucun retry.`);
          resolve(lastCode);
        }
      });
    }

    tryOnce();
  });
}

const USAGE = `Usage: node scripts/git-retry.mjs [options] -- <git args...>

Lance une commande git avec retry automatique contre le fork-panic msys
(exit 254/66, "fork: Resource temporarily unavailable", uv_spawn EUNKNOWN).
Un échec git réel (lint du hook, conflit, …) n'est jamais masqué.

Options:
  --attempts N    nombre maximal de tentatives (défaut: 3)
  --wait-ms N     délai entre tentatives en ms (défaut: 5000)
  --timeout-ms N  timeout par tentative en ms, kill de l'arbre entier (défaut: 300000)
  --sweep         purger avant chaque retry les orphelins Node connus de la chaîne qualité
  -h, --help      cette aide

Exemples:
  node scripts/git-retry.mjs commit -am "message"
  node scripts/git-retry.mjs push origin main
  npm run git:retry -- commit -am "message"`;

/** Parse wrapper options, then [--] and the git args. */
export function parseArgs(argv) {
  const opts = { attempts: 3, waitMs: 5000, timeoutMs: 300000, sweep: false };
  const args = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      args.push(...argv.slice(i + 1));
      break;
    }
    const m = a.match(/^--(attempts|wait-ms|timeout-ms)(?:=(.*))?$/);
    if (m) {
      const val = m[2] ?? argv[i + 1];
      const num = parseInt(val ?? '', 10);
      if (m[1] === 'attempts') opts.attempts = Math.max(1, Number.isFinite(num) ? num : 1);
      else if (m[1] === 'wait-ms') opts.waitMs = Math.max(0, Number.isFinite(num) ? num : 0);
      else opts.timeoutMs = Math.max(0, Number.isFinite(num) ? num : 0);
      i += m[2] ? 1 : 2;
      continue;
    }
    if (a === '--sweep') {
      opts.sweep = true;
      i++;
      continue;
    }
    if (a === '-h' || a === '--help') {
      opts.help = true;
      i++;
      continue;
    }
    args.push(a);
    i++;
  }
  return { args, opts };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { args, opts } = parseArgs(process.argv.slice(2));
  if (opts.help || args.length === 0) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 2);
  }
  runGitWithRetry(args, opts).then((code) => process.exit(code));
}