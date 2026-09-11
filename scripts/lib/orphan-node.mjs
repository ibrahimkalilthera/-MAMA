// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/orphan-node.mjs — purge the node.exe processes THIS run created,
// keep it honest about what it could not do, and record every purge so the
// trigger of the msys fork panic can be measured instead of guessed.
//
// MEASURED FIRST, BECAUSE THE OBVIOUS MODEL OF THE PANIC IS WRONG
// ---------------------------------------------------------------
// The documented trigger (DEVELOPMENT_HISTORY.md, "msys fork panic") is an
// orphaned node.exe left behind by a hard timeout. Measured on this machine,
// that is not how a node tree leaks:
//
//   1. A NON-DETACHED node CHILD DIES WITH ITS PARENT. Nine descendants of a
//      node root were all gone within 500 ms of `taskkill /PID <root> /F`
//      (no /T) — and identically after `Stop-Process -Force`. This is Node's
//      documented Windows behaviour (only `detached: true` lets a child outlive
//      its parent); libuv enforces it with a job object. So killing the chain
//      already takes its live tree with it, and this purge is a belt for what
//      the job does NOT cover, not a plug for a leak.
//
//   2. THE ORPHAN SHAPE IS THE DETACHED CHILD. A probe built exactly that way
//      (`detached: true`, then only the root killed) left **1 of its 4
//      descendants alive**, which this purge then killed: 1 killed, 2 passes,
//      0 survivors.
//
//   3. THE OTHER REACHABLE ORPHAN IS A WRAPPER WHOSE PARENT DIED. The panic
//      hits the `sh.exe` that git uses to run a hook, and the node wrapper it
//      had already started keeps running — an orphan that is itself the whole
//      quality chain. That one is stale by definition (its pid is long gone),
//      so the selective command-line filter in ./git-retry.mjs is the right
//      tool for it, and it matches exactly those wrappers.
//
//   4. LINEAGE SURVIVES THE ROOT. Descendants are found by closing over
//      ParentProcessId; Windows retains that field when the creator exits, so a
//      walk anchored at a DEAD pid still finds the survivors — measured: 1 of 3,
//      precisely the detached one. The earlier "the closure collapses, 4 → 1"
//      reading was wrong (the other three had died with their parent, fact 1)
//      and is corrected here on purpose: that explanation had been encoded in
//      comments and in a test.
//
// SO: kill exactly what THIS run created, identified by pid + creation stamp —
// a pid recycled in the meantime carries a different stamp and is skipped, so
// this can never kill an unrelated node.exe (a dev server, another agent's
// chain) — and RECORD every purge, zeros included, so "how often does the panic
// really happen?" stops being an anecdote (`npm run orphans:report`).
//
// Callers:
//   - scripts/quality-chain.mjs  → roots = [its own pid], still alive at exit,
//     on EVERY exit path (normal end, failing step, SIGINT/SIGTERM).
//   - scripts/lib/orphan-guard.mjs → the detached guard RECORDS descendants
//     while the chain lives (so the kill set is anchored in a live tree rather
//     than a possibly recycled pid), then purges once the chain is gone. Its
//     snapshot interval bounds the one residual race — a descendant spawned in
//     the last window before an external kill — which is documented, and which
//     the selective sweep above still covers conservatively.
//
// Windows only: on POSIX the shell reaps these children. Best-effort always:
// a purge that fails never fails a run, but it is COUNTED as a failure instead
// of being reported as "nothing to kill".
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Purge log, under the already-ignored node_modules cache. */
export const SWEEP_LOG_REL = 'node_modules/.cache/quality-chain-sweeps.jsonl';

/** How many passes a purge may run before giving up (children die in waves). */
const DEFAULT_PASSES = 4;
const DEFAULT_WAIT_MS = 1200;
const DEFAULT_TIMEOUT_MS = 10000;
/** A pass that could not run at all is retried this many times before giving up. */
const FAILURE_RETRIES = 3;
/** A guard is never a target: it lives to clean up, not to be cleaned up. */
const GUARD_SCRIPT = 'orphan-guard.mjs';

/**
 * PowerShell that prints every descendant of `rootPids` (the roots included),
 * at any depth, with its creation stamp. Only meaningful while the roots are
 * alive — see the header. Pure: the policy is asserted without spawning.
 * @param {{ rootPids?: number[] }} options
 * @returns {string}
 */
export function buildDescendantSnapshotScript({ rootPids = [] } = {}) {
  const roots = rootPids.filter((p) => Number.isInteger(p) && p > 0);
  return [
    `$all = @(Get-CimInstance Win32_Process);`,
    `$ids = New-Object System.Collections.Generic.HashSet[int];`,
    ...roots.map((p) => `[void]$ids.Add(${p});`),
    `$changed = $true;`,
    `while ($changed) { $changed = $false;` +
      ` foreach ($p in $all) {` +
      ` if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId))` +
      ` { [void]$ids.Add([int]$p.ProcessId); $changed = $true } } }`,
    `foreach ($p in $all) {`,
    `if ($ids.Contains([int]$p.ProcessId)) {`,
    `Write-Output ('PID=' + $p.ProcessId + ';NAME=' + $p.Name + ';BORN=' + $p.CreationDate.ToString('o'))`,
    `}`,
    `}`,
  ].join(' ');
}

/**
 * Parse the snapshot output. Unparsable lines are dropped (diagnostics, never
 * a gate).
 * @param {string} stdout
 * @returns {{ pid: number, name: string, born: string }[]}
 */
export function parseDescendantSnapshot(stdout) {
  return [...String(stdout ?? '').matchAll(/PID=(\d+);NAME=([^;\r\n]*);BORN=([^;\r\n]+)/g)].map((m) => ({
    pid: Number(m[1]),
    name: m[2],
    born: m[3],
  }));
}

/**
 * PowerShell that kills the given targets — but only while each one still
 * carries the creation stamp we recorded. That equality IS the safety: a pid
 * that has been recycled in the meantime is a different process, and killing
 * it would mean killing someone else's node.exe.
 * @param {{ targets?: { pid: number, born: string }[], excludePid?: number }} options
 * @returns {string}
 */
export function buildKillScript({ targets = [], excludePid = 0 } = {}) {
  const list = targets
    .filter((t) => Number.isInteger(t.pid) && t.pid > 0 && typeof t.born === 'string')
    .map((t) => `'${t.pid}|${t.born.replace(/'/g, "''")}'`)
    .join(',');
  return [
    `$targets = @(${list});`,
    `$all = @(Get-CimInstance Win32_Process);`,
    `$k = 0;`,
    `foreach ($t in $targets) {`,
    `$parts = $t.Split('|');`,
    `$p = $all | Where-Object { [int]$_.ProcessId -eq [int]$parts[0] };`,
    `if ($null -ne $p -and $p.Name -eq 'node.exe' -and [int]$p.ProcessId -ne ${excludePid}` +
      ` -and ([string]$p.CommandLine) -notmatch '${GUARD_SCRIPT.replace('.', '\\.')}'` +
      ` -and $p.CreationDate.ToString('o') -eq $parts[1]) {`,
    `Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $k++`,
    `}`,
    `}`,
    // Marker, not a bare number: "could not look" and "nothing to kill" must
    // never be the same output. The first version of this purge made them the
    // same and was measured as a silent no-op on a real, freshly killed chain.
    `Write-Output ('KILLED=' + $k)`,
  ].join(' ');
}

/**
 * Spawn one PowerShell pass and resolve `{ ok, stdout, error }`. `ok: false`
 * means we could not even LOOK (the panic that produced the orphans also makes
 * powershell fail to spawn).
 */
function runPowershell(script, timeoutMs) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('powershell', ['-NoProfile', '-Command', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      resolve({ ok: false, stdout: '', error: err?.message ?? 'spawn failed' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      finish({ ok: false, stdout, error: `timeout (${timeoutMs} ms)` });
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      finish({ ok: false, stdout, error: err?.message ?? 'spawn error' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 && !stdout) {
        finish({ ok: false, stdout, error: (stderr.trim() || `exit ${code}`).slice(0, 400) });
        return;
      }
      finish({ ok: true, stdout });
    });
  });
}

/**
 * Snapshot the descendants of live root pids. Returns `null` when the snapshot
 * could not be taken — never an empty list, which would be indistinguishable
 * from "no descendants".
 * @param {{ rootPids: number[], platform?: string, timeoutMs?: number,
 *   runScript?: (script: string, timeoutMs: number) => Promise<{ ok: boolean, stdout: string, error?: string }> }} options
 * @returns {Promise<{ pid: number, name: string, born: string }[] | null>}
 */
export async function snapshotDescendants({
  rootPids,
  platform = process.platform,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  runScript = runPowershell,
} = {}) {
  if (platform !== 'win32') return null;
  const roots = (rootPids ?? []).filter((p) => Number.isInteger(p) && p > 0);
  if (roots.length === 0) return null;
  let result;
  try {
    result = await runScript(buildDescendantSnapshotScript({ rootPids: roots }), timeoutMs);
  } catch (err) {
    return null;
  }
  if (!result || result.ok !== true) return null;
  return parseDescendantSnapshot(result.stdout);
}

/**
 * Kill this run's own surviving node.exe orphans, identified by what we
 * recorded while the run was alive (`recorded`) and/or by a snapshot of still
 * live roots (`rootPids`).
 *
 * Repeats until a pass finds nothing left to kill: a killed parent's children
 * die a moment later, so a single pass is a race. A pass that could not RUN is
 * retried and counted in `failed` — never folded into `killed`. Never rejects.
 * @param {{ rootPids?: number[], recorded?: { pid: number, name?: string, born: string }[],
 *   excludePid?: number, passes?: number, waitMs?: number, timeoutMs?: number,
 *   platform?: string, log?: (message: string) => void,
 *   snapshot?: (options: object) => Promise<{ pid: number, name: string, born: string }[] | null>,
 *   runScript?: (script: string, timeoutMs: number) => Promise<{ ok: boolean, stdout: string, error?: string }>,
 *   sleep?: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ killed: number, passes: number, failed: number, seen: number }>}
 */
export async function sweepOwnNodeOrphans({
  rootPids = [],
  recorded = [],
  excludePid = process.pid,
  passes = DEFAULT_PASSES,
  waitMs = DEFAULT_WAIT_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  platform = process.platform,
  log = () => {},
  snapshot,
  runScript = runPowershell,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  const nothing = { killed: 0, passes: 0, failed: 0, seen: 0 };
  if (platform !== 'win32') return nothing;
  const roots = (rootPids ?? []).filter((p) => Number.isInteger(p) && p > 0);
  const snapshotFn = snapshot ?? ((options) => snapshotDescendants({ ...options, platform, runScript, timeoutMs }));

  // pid → { pid, name, born }: everything this run is known to have created.
  const known = new Map();
  for (const entry of recorded ?? []) {
    if (Number.isInteger(entry?.pid) && entry.pid > 0 && typeof entry?.born === 'string') {
      known.set(entry.pid, { pid: entry.pid, name: entry.name ?? 'node.exe', born: entry.born });
    }
  }

  const targets = () =>
    [...known.values()].filter(
      (e) => e.name === 'node.exe' && e.pid !== excludePid && !e.born.includes(GUARD_SCRIPT),
    );

  // Nothing to look at and nothing remembered: no pass, no noise.
  if (roots.length === 0 && targets().length === 0) return nothing;

  let killed = 0;
  let attempts = 0;
  let failed = 0;
  let seen = 0;
  let consecutiveFailures = 0;
  for (let i = 0; i < Math.max(1, passes); i++) {
    const canLook = roots.length > 0;
    let fresh = null;
    if (canLook) {
      try {
        fresh = await snapshotFn({ rootPids: roots, platform, timeoutMs });
      } catch {
        fresh = null;
      }
    }
    attempts++;
    for (const entry of fresh ?? []) {
      if (entry.pid === excludePid) continue;
      if (!known.has(entry.pid)) seen++;
      known.set(entry.pid, entry);
    }

    const candidates = targets();
    // We had a live root to look at, could not look, and know of nothing:
    // whether anything survived is genuinely UNKNOWN. Retry, and report it as
    // a failure rather than as a clean "nothing to purge".
    if (canLook && fresh === null && candidates.length === 0) {
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_RETRIES) break;
      await sleep(waitMs);
      continue;
    }
    if (candidates.length === 0) break; // looked, and nothing of ours is left

    let result;
    try {
      result = await runScript(buildKillScript({ targets: candidates, excludePid }), timeoutMs);
    } catch (err) {
      result = { ok: false, stdout: '', error: err?.message ?? String(err) };
    }
    const match = result?.ok === true ? String(result.stdout).match(/KILLED=(\d+)/) : null;
    if (!match) {
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= FAILURE_RETRIES) break;
      await sleep(waitMs);
      continue;
    }
    consecutiveFailures = 0;
    const n = parseInt(match[1], 10);
    killed += n;
    // Every candidate is re-checked next pass (a killed process is simply not
    // found again), so a target that refuses to die is retried rather than
    // forgotten — and the loop stays bounded by `passes`.
    if (n === 0) break; // everything we knew about is gone
    if (i < passes - 1) await sleep(waitMs);
  }

  if (killed > 0) {
    log(`🧹 ${killed} node.exe orphelin(s) de cette exécution purgé(s) en ${attempts} passe(s)`);
  }
  if (failed > 0) {
    log(
      `⚠️  purge impossible à exécuter (${failed} tentative(s)) — des orphelins peuvent subsister : ` +
        `powershell n'a pas répondu (fork-panic). Relancer, ou \`npm run orphans:report\`.`,
    );
  }
  return { killed, passes: attempts, failed, seen };
}

/** Absolute path of the purge log. */
export function sweepLogPath(root = process.cwd()) {
  return join(root, SWEEP_LOG_REL);
}

/**
 * Append one purge record. Zeros are recorded on purpose: without them the log
 * has no denominator, and "how often does the panic happen?" stays unanswerable.
 * Best-effort — returns false instead of throwing.
 * @param {Record<string, unknown>} entry
 */
export function recordSweep(entry, { root = process.cwd(), write = appendFileSync } = {}) {
  try {
    const file = sweepLogPath(root);
    mkdirSync(dirname(file), { recursive: true });
    write(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the purge log, oldest first. Unreadable or malformed lines are skipped
 * (the log is diagnostics, never a gate).
 * @returns {Record<string, unknown>[]}
 */
export function readSweepLog({ root = process.cwd() } = {}) {
  try {
    return readFileSync(sweepLogPath(root), 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((e) => e !== null);
  } catch {
    return [];
  }
}
