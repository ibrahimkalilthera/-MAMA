// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/orphan-guard.mjs — detached guard that purges the quality
// chain's OWN orphaned node.exe processes, even when the chain is killed from
// OUTSIDE.
//
// Context (DEVELOPMENT_HISTORY.md, "msys fork panic"): the documented trigger
// of the panic is an orphaned node.exe left by a run killed by a hard timeout.
// quality-chain.mjs already kills each step's whole tree on its OWN watchdog
// timeout and sweeps at the end of a normal run — but an EXTERNAL kill
// (agent/CI/tool timeout, Task Manager, `taskkill /T`) never gives it the
// chance to run that cleanup: whatever survives keeps holding the fork table,
// and the NEXT msys fork (git hook, bash) panics.
//
// So quality-chain.mjs starts this guard at startup and the guard outlives it:
//   - DOUBLE SPAWN — the chain spawns `--relay <pid>`, which re-spawns the real
//     guard DETACHED and exits immediately. The guard's parent (the dead relay)
//     is no longer part of the chain's process tree, so a `taskkill /T` on that
//     tree cannot reach it.
//   - Once the chain pid is gone — for ANY reason, external kill included — it
//     runs the selective orphan sweep (scripts/git-retry.mjs
//     sweepOrphanNodeProcesses: known quality-chain command lines whose parent
//     is gone, or stale ones). It never touches unrelated node.exe processes.
//   - Bounded and best-effort: it gives up after maxMs and swallows every
//     failure — it is a cleaner, not a gatekeeper.
//
// Windows only (the platform where these orphans accumulate and hurt).
// Usage (internal):
//   node scripts/lib/orphan-guard.mjs --relay <chainPid>   (relay + exit)
//   node scripts/lib/orphan-guard.mjs <chainPid>           (watch + sweep)
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sweepOrphanNodeProcesses } from '../git-retry.mjs';

const POLL_MS = 2000;
const MAX_MS = 60 * 60 * 1000; // hard cap: never linger for more than an hour

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Signal 0 = existence probe; EPERM still means the process exists. */
function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * Poll the parent pid and sweep its orphans once it is gone.
 * Resolves with 'swept', 'timeout' or 'invalid-pid'; never rejects.
 * All collaborators are injectable so the policy is unit-testable without
 * spawning anything.
 * @param {{ parentPid?: number, pollMs?: number, maxMs?: number,
 *   isAlive?: (pid: number) => boolean, sweep?: () => unknown,
 *   sleep?: (ms: number) => Promise<void> }} options
 */
export async function watchParentAndSweep({
  parentPid,
  pollMs = POLL_MS,
  maxMs = MAX_MS,
  isAlive = defaultIsAlive,
  sweep = () => sweepOrphanNodeProcesses({}),
  sleep = wait,
} = {}) {
  if (!Number.isInteger(parentPid) || parentPid <= 0) return 'invalid-pid';
  const checks = Math.max(1, Math.ceil(maxMs / pollMs));
  await sleep(pollMs);
  for (let i = 0; i < checks; i++) {
    if (!isAlive(parentPid)) {
      // Let the external kill finish tearing the tree down, then clean up.
      await sleep(pollMs);
      try {
        await sweep();
      } catch {
        /* best-effort cleaner: a failed sweep must never surface */
      }
      return 'swept';
    }
    await sleep(pollMs);
  }
  return 'timeout';
}

/**
 * Start the detached guard for this process (best-effort, never throws).
 * Returns true when the relay was spawned, false otherwise.
 * @param {{ parentPid?: number, platform?: string, execPath?: string,
 *   selfUrl?: string }} options
 */
export function spawnOrphanGuard({
  parentPid = process.pid,
  platform = process.platform,
  execPath = process.execPath,
  selfUrl = import.meta.url,
} = {}) {
  if (platform !== 'win32') return false;
  try {
    const relay = spawn(execPath, [fileURLToPath(selfUrl), '--relay', String(parentPid)], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    relay.unref();
    return true;
  } catch {
    return false;
  }
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === '--relay') {
    // Double-spawn: the relay exits at once, so the real guard is orphaned out
    // of the chain's process tree and survives a `taskkill /T` on it.
    try {
      const guard = spawn(
        process.execPath,
        [fileURLToPath(import.meta.url), String(Number(args[1]))],
        { detached: true, stdio: 'ignore', windowsHide: true },
      );
      guard.unref();
    } catch {
      /* nothing we can do — the chain's own end-of-run sweep still runs */
    }
    process.exit(0);
  }
  watchParentAndSweep({ parentPid: Number(args[0]) }).then(() => process.exit(0));
}