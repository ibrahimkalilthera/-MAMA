#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/git-retry.mjs — run a git command (commit, push, …) with automatic
// retry against the transient msys fork panic of this machine.
//
// Context (documented in DEVELOPMENT_HISTORY.md, "msys fork-panic recovery
// procedure"): Git Bash periodically enters a state where every external
// command fails — `fork: Resource temporarily unavailable` (exit 254 for
// multi-command lines, exit 66 even for `node -e`), occasionally
// `uv_spawn: EUNKNOWN`. The documented trigger is an orphaned node.exe left by
// a hard timeout; measured (scripts/lib/orphan-node.mjs), a NON-detached node
// child dies with its parent, so what can actually survive is a detached child
// or a wrapper whose `sh.exe` died mid-hook. The panic also kills husky hooks (the hook content itself is fine —
// spawn-only watchdog — but the sh wrapper that git uses to run it dies of
// the fork bug, so `git commit`/`git push` abort with a panic exit code).
// Recovery was manual: probe, retry at the keyboard, kill orphaned node.exe.
//
// The stateful long commands (pull, rebase) are covered by the same retry
// engine: they run hooks too (post-merge, post-rewrite, pre-rebase) and a
// panic mid-replay leaves a work to clean up by hand — which is the situation
// the retry is cheapest to prevent. A conflict or a diverged branch is a real
// failure and is never retried.
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
//   - ALIAS-SAFE: a user-level alias for the wrapped subcommand is neutralized
//     for the inner git spawn (`-c alias.<cmd>=<cmd>`), so the wrapper always
//     controls the real command — an alias can never recurse into the wrapper
//     or add non-retryable behavior. (Note: git 2.55 refuses aliases that
//     shadow a builtin — `alias.commit` is ignored at dispatch — so only
//     non-builtin alias names can actually recurse.)
//   - scripts/hook-quality-chain.mjs reuses the same retry engine for the
//     pre-commit quality chain (see .husky/pre-commit).
//
// Usage:
//   node scripts/git-retry.mjs commit -am "message"
//   node scripts/git-retry.mjs push origin main
//   node scripts/git-retry.mjs pull --rebase
//   node scripts/git-retry.mjs --sweep --attempts 5 --wait-ms 2000 -- push origin main
//   node scripts/git-retry.mjs --sweep-all -- push origin main   (purge élargie)
//   npm run git:retry -- commit -am "message"
// ─────────────────────────────────────────────────────────────────────────────
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { KNOWN_CHAIN_WRAPPER_PATTERN, recordSweep } from './lib/orphan-node.mjs';

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

// The optional sweep is selective by default: only known quality-chain command
// lines are eligible (and only when hung/left over). With `all: true` (CLI
// --sweep-all) the command-line filter is dropped — but eligibility stays a
// TRUE ORPHAN check (parent gone). Deliberately NOT the "parent gone OR older
// than the stale window" rule of the selective mode: that would kill a
// legitimately long-running node.exe such as a dev server started 10 minutes
// ago whose parent is still alive.
const NODE_ORPHAN_SWEEP_SCRIPT = (minAgeMinutes, all = false) => [
  `$cut = (Get-Date).AddMinutes(-${minAgeMinutes});`,
  `$processes = @(Get-CimInstance Win32_Process);`,
  `$all = @($processes | Where-Object { $_.Name -eq 'node.exe' });`,
  `$ids = @($processes | ForEach-Object { [int]$_.ProcessId });`,
  `$k = 0; foreach ($p in $all) { $cmd = [string]$p.CommandLine;`,
  `$parentGone = $ids -notcontains [int]$p.ParentProcessId;`,
  `$old = ($null -ne $p.CreationDate) -and ($p.CreationDate -lt $cut);`,
  all
    ? `$eligible = $parentGone;`
    : `$eligible = ($cmd -match '${KNOWN_CHAIN_WRAPPER_PATTERN}') -and ($parentGone -or $old);`,
  `if ($eligible) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $k++ } }; $k`,
].join(' ');

/**
 * Write one journal entry — except from a TEST RUN, which never journalises.
 *
 * The rule has to be automatic and class-wide, not a flag one suite remembers
 * to set: measured, `tests/hook-quality-chain.test.ts` exercises the real
 * wrapper (`--sweep` included) end to end and wrote **17 phantom entries** into
 * the real journal — exactly the noise that makes "how often does the panic
 * happen?" unreadable, which is the journal's only reason to exist. The node
 * test runner sets `NODE_TEST_CONTEXT` in every test child, and children of a
 * test inherit it, so the marker protects every suite, present and future.
 * `GIT_RETRY_NO_JOURNAL=1` stays as an explicit opt-out for anything else.
 * Best-effort: a journal that cannot be written never fails a git command.
 * @param {Record<string, unknown>} entry
 * @param {{ record?: (entry: Record<string, unknown>) => unknown, env?: NodeJS.ProcessEnv }} [options]
 */
export function recordGitRetryEvent(entry, { record = recordSweep, env = process.env } = {}) {
  if (env.NODE_TEST_CONTEXT || env.GIT_RETRY_NO_JOURNAL === '1') return false;
  try {
    return record(entry) !== false;
  } catch {
    return false;
  }
}

/**
 * Best-effort sweep of orphaned Node processes. It is opt-in because even a
 * process sweep must never be implicit in a git command. By default a process
 * is eligible only when its command line belongs to the quality chain/test
 * runner AND its parent is gone or it is older than the stale-age window;
 * with `all: true` the command-line filter is dropped (any node.exe orphan).
 * Returns the number killed; never rejects.
 *
 * Every invocation is JOURNALED (`git-retry:sweep` / `git-retry:sweep-all`),
 * zeros included: this is the path the panic actually hits — inside a git
 * command — so "how often does a purge find something to kill?" was the one
 * number the chain-side purge could not produce. A pass that could not RUN
 * (powershell killed by the panic itself) is recorded as `failed`, never as a
 * clean "nothing to kill".
 */
export function sweepOrphanNodeProcesses({
  minAgeMinutes = 5,
  timeoutMs = 10000,
  platform = process.platform,
  log = () => {},
  all = false,
  git = '',
  phase = 'start',
  // Callers that run the sweep for something OTHER than a git command (the
  // pre-commit hook drives the chain through this same engine) must be able to
  // say so: lumping their sweeps under `git-retry:sweep` would misattribute the
  // frequency to the wrong path, which is the one thing this journal is for.
  origin = '',
  record = recordSweep,
  env = process.env,
} = {}) {
  if (platform !== 'win32') return Promise.resolve(0);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (count, failed = false) => {
      if (settled) return;
      settled = true;
      const n = Number.isFinite(count) ? count : 0;
      if (n > 0) {
        log(
          all
            ? `🧹 ${n} processus Node orphelin(s) purgé(s) (sweep élargi)`
            : `🧹 ${n} processus Node orphelin(s) de la chaîne qualité purgé(s)`,
        );
      }
      if (failed) {
        log(
          '⚠️  purge --sweep impossible à exécuter (powershell n\'a pas répondu — fork-panic) : ' +
            'des orphelins peuvent subsister. `npm run orphans:report` les compte.',
        );
      }
      recordGitRetryEvent(
        {
          kind: 'purge',
          origin: origin || (all ? 'git-retry:sweep-all' : 'git-retry:sweep'),
          killed: n,
          failed,
          all,
          minAgeMinutes,
          git,
          phase,
        },
        { record, env },
      );
      resolve(n);
    };
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-Command', NODE_ORPHAN_SWEEP_SCRIPT(minAgeMinutes, all)], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      // Could not even LOOK — the panic that justifies the sweep also stops
      // powershell from starting. Distinct from "nothing to kill".
      finish(0, true);
      return;
    }
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      finish(0, true);
    }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', () => {
      clearTimeout(timer);
      finish(0, true);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const parsed = out.match(/\d+/);
      // The script always prints the count, so a non-zero exit with no output
      // is a failure to look, not a clean zero.
      finish(parsed ? parseInt(parsed[0], 10) : 0, !parsed && code !== 0);
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
 * Resolve the REAL git binary to spawn. The repo-local shim
 * (scripts/git-shim.cmd, installed as git.cmd on the user PATH) forwards
 * commit/push/pull/rebase to this wrapper, so spawning plain `git` here could
 * re-enter the shim; node cannot spawn a .cmd without a shell anyway. Priority:
 *  1. GIT_RETRY_REAL_GIT (set by the shim itself before invoking us),
 *  2. `where git.exe` (which skips .cmd files - always the genuine binary),
 *  3. plain `git` as a last resort (non-Windows / resolution failure).
 */
export function resolveGit({ env = process.env, platform = process.platform } = {}) {
  if (env.GIT_RETRY_REAL_GIT) return env.GIT_RETRY_REAL_GIT;
  if (platform !== 'win32') return 'git';
  try {
    const r = spawnSync('where', ['git.exe'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/).find((line) => line.trim());
      if (first) return first.trim();
    }
  } catch {
    /* fall through to the plain name */
  }
  return 'git';
}

/**
 * Git commands are dispatched through aliases from the user's config. The
 * wrapper must run the REAL subcommand: a `!` alias for the wrapped subcommand
 * would otherwise recurse — wrapper → git → alias → wrapper → … Neutralizing
 * `alias.<cmd>=<cmd>` makes git dispatch to the builtin, which is exactly what
 * the retry loop needs to control, and guarantees a user-level alias for the
 * wrapped subcommand can never mask a real failure or add non-retryable
 * behavior. (git 2.55 already ignores aliases that shadow a builtin, so the
 * guard matters for non-builtin subcommand names.)
 */
export function neutralizeAlias(args) {
  const cmd = args[0];
  if (!cmd || cmd.startsWith('-') || !/^[a-z][a-z0-9-]*$/i.test(cmd)) return args;
  return ['-c', `alias.${cmd}=${cmd}`, ...args];
}

/**
 * The git subcommand inside an argv that may start with options of ours
 * (`-c alias.push=push`, from neutralizeAlias) or of git's own (`-C <dir>`,
 * `--git-dir=…`). Used for the journal: the report must name the command the
 * panic interrupted, and `alias.push=push` is not a command. Pure.
 * @param {string[]} [args]
 * @returns {string} '' when there is none
 */
export function gitSubcommand(args = []) {
  const takesValue = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace']);
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i] ?? '');
    if (takesValue.has(a)) {
      i++; // skip the value too
      continue;
    }
    if (a.startsWith('-')) continue;
    // A subcommand NAME, never the inline script of a `-e` flag: the journal
    // must not record a whole program as "the git command".
    return /^[a-z][a-z0-9-]*$/i.test(a) ? a : '';
  }
  return '';
}

/**
 * Run a command with bounded automatic retry on the msys fork panic.
 * Resolves with the command's exit code (0 on success); never rejects.
 * A real failure (non-panic exit code / clean stderr) is never retried.
 * @param {string} command
 * @param {string[]} args
 * @param {{ attempts?: number, waitMs?: number, timeoutMs?: number,
 *   forwardStderr?: boolean, log?: (...data: unknown[]) => void,
 *   sweep?: boolean, sweepFn?: (() => unknown),
 *   sweepAll?: boolean, platform?: string, label?: string, sweepOrigin?: string,
 *   record?: (entry: Record<string, unknown>) => unknown, env?: NodeJS.ProcessEnv }} options
 */
export function runCommandWithRetry(
  command,
  args,  /** @type {{ attempts?: number, waitMs?: number, timeoutMs?: number,
   *   forwardStderr?: boolean, log?: (...data: unknown[]) => void,
   *   sweep?: boolean, sweepFn?: (() => unknown),
   *   sweepAll?: boolean, platform?: string, label?: string, sweepOrigin?: string,
   *   record?: (entry: Record<string, unknown>) => unknown, env?: NodeJS.ProcessEnv }} */
  {
    attempts = 3,
    waitMs = 5000,
    timeoutMs = 300000,
    forwardStderr = true,
    log = console.log,
    sweep = false,
    sweepFn = undefined,
    sweepAll = false,
    platform = process.platform,
    label = `${command} ${args.join(' ')}`,
    sweepOrigin = '',
    record = recordSweep,
    env = process.env,
  } = {},
) {
  return new Promise((resolve) => {
    let attempt = 0;
    let lastCode = 1;
    // The git subcommand, for the journal: `git push` and `git rebase` are the
    // commands a panic interrupts at the worst moment, so the report has to be
    // able to say which one was hit.
    const subcommand = gitSubcommand(args);

    // Best-effort orphan purge (opt-in via --sweep / --sweep-all). Runs before
    // the FIRST attempt AND between retries; a sweep failure never prevents
    // the retry itself. Selectivity is the safety: by default only known
    // quality-chain orphans (parent gone / older than the stale window) are
    // killed; --sweep-all drops the command-line filter.
    const runSweepOnce = (phase) =>
      Promise.resolve()
        .then(
          sweepFn ||
            (() =>
              sweepOrphanNodeProcesses({
                log,
                all: sweepAll,
                platform,
                git: subcommand,
                phase,
                origin: sweepOrigin,
                record,
                env,
              })),
        )
        .catch(() => {});

    const retryOrGiveUp = (reason) => {
      if (attempt < attempts) {
        const continueRetry = () => {
          log(`↻ ${reason} — retry dans ${waitMs} ms (tentative ${attempt + 1}/${attempts})`);
          setTimeout(tryOnce, waitMs);
        };
        if (sweep || sweepFn || sweepAll) {
          runSweepOnce('retry').then(continueRetry);
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
      log(`⏳ ${label} — tentative ${attempt}/${attempts}`);
      const child = spawn(command, args, {
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
          log(`✅ ${label} OK.`);
          resolve(0);
          return;
        }
        if (isForkPanicFailure(lastCode, stderrTail)) {
          // The event the report is really about: the panic ITSELF, not only the
          // purges that follow it. Without it, "how often does it happen?" still
          // depends on someone having used --sweep.
          recordGitRetryEvent(
            { kind: 'panic', origin: 'git-retry:panic', git: subcommand, exitCode: lastCode, attempt },
            { record, env },
          );
          retryOrGiveUp(`fork-panic msys (exit ${lastCode})`);
        } else {
          log(`❌ ${command} a échoué (exit ${lastCode}) — pas un fork-panic, aucun retry.`);
          resolve(lastCode);
        }
      });
    }

    // With --sweep/--sweep-all, purge orphans BEFORE the first attempt too:
    // the orphaned node.exe left by a previous watchdog timeout is what keeps
    // the panic alive, so clearing it up front lets attempt 1 succeed
    // immediately.
    const start = () => {
      if (sweep || sweepFn || sweepAll) {
        runSweepOnce('start').then(tryOnce);
      } else {
        tryOnce();
      }
    };

    start();
  });
}

/**
 * Run `git <args>` with bounded automatic retry on the msys fork panic.
 * Resolves with git's exit code (0 on success); never rejects. The subcommand
 * alias is neutralized so the retry loop controls the real git command (see
 * neutralizeAlias).
 * @param {string[]} args
 * @param {{ attempts?: number, waitMs?: number, timeoutMs?: number,
 *   forwardStderr?: boolean, log?: (...data: unknown[]) => void,
 *   sweep?: boolean, sweepFn?: (() => unknown), sweepAll?: boolean,
 *   platform?: string, sweepOrigin?: string,
 *   record?: (entry: Record<string, unknown>) => unknown,
 *   env?: NodeJS.ProcessEnv }} options
 */
export function runGitWithRetry(args, options = {}) {
  return runCommandWithRetry(resolveGit(), neutralizeAlias(args), {
    ...options,
    label: `git ${args.join(' ')}`,
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
  --sweep         purger avant la 1re tentative et entre les retries les orphelins Node connus de la chaîne qualité
                  — chaque purge est journalisée (nombre tué, quand, quelle commande git) : npm run orphans:report
  --sweep-all     purge ÉLARGIE : TOUS les node.exe orphelins (parent disparu),
                  pas seulement la chaîne qualité — agressif, opt-in
  -h, --help      cette aide

Exemples:
  node scripts/git-retry.mjs commit -am "message"
  node scripts/git-retry.mjs push origin main
  node scripts/git-retry.mjs rebase main
  node scripts/git-retry.mjs --sweep-all -- push origin main
  npm run git:retry -- commit -am "message"`;

/** Parse wrapper options, then [--] and the git args. */
export function parseArgs(argv) {
  const opts = { attempts: 3, waitMs: 5000, timeoutMs: 300000, sweep: false, sweepAll: false };
  const args = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') {
      // The wrapper's own option terminator — but only BEFORE the git
      // subcommand. Once git args have started, a bare `--` belongs to git:
      // `git pull -- origin main` and `git commit -- <pathspec>` are valid
      // invocations, and swallowing the separator would turn the first into
      // `git origin main` — a failure the shim would have introduced.
      if (args.length > 0) {
        args.push(a);
        i++;
        continue;
      }
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
    if (a === '--sweep-all') {
      opts.sweepAll = true;
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