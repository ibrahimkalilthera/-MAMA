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
//   - While the chain lives, it RECORDS the chain's descendants (pid +
//     creation stamp). Recording in a LIVE tree is what makes the kill set
//     verifiable: each target is checked against the creation stamp recorded
//     here, so a recycled pid can never be mistaken for one of ours. Once the
//     chain is gone for ANY reason, it kills exactly what it recorded and is
//     still alive, then runs the selective command-line sweep (./git-retry.mjs)
//     for leftovers of runs whose pid is long gone.
//
//   Measured (see ./orphan-node.mjs): a non-detached node child dies with its
//   parent — 9/9 gone 500 ms after the root alone was killed — so the reachable
//   orphan is the DETACHED one (1 of 4 survived in the probe this purge then
//   killed) or a wrapper whose non-node parent died (the panic's own product:
//   the `sh.exe` running a git hook dies, the node wrapper it started stays).
//   The command-line sweep is the right tool for that stale wrapper; lineage is
//   the right tool for a tree that is still attached.
//   - Bounded and best-effort: it gives up after maxMs and swallows every
//     failure — it is a cleaner, not a gatekeeper.
//
// Windows only (the platform where these orphans accumulate and hurt).
// Usage (internal):
//   node scripts/lib/orphan-guard.mjs --relay <chainPid>   (relay + exit)
//   node scripts/lib/orphan-guard.mjs <chainPid>           (watch + record + purge)
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sweepOrphanNodeProcesses } from '../git-retry.mjs';
import { recordSweep, snapshotDescendants, sweepOwnNodeOrphans } from './orphan-node.mjs';

const POLL_MS = 2000;
// Registering descendants means spawning powershell, so it is much slower than
// the liveness poll. The interval bounds the one residual hole: a subtree
// spawned in the last window before an external kill escapes (documented in
// ./orphan-node.mjs, and visible in the log rather than hidden).
const SNAPSHOT_MS = 10000;
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
 * Default cleaner: kill what we RECORDED while the chain was alive, then the
 * selective command-line sweep for leftovers of runs whose pid is long gone
 * (they are not descendants of this chain, so lineage cannot see them).
 * Never rejects.
 */
async function sweepChainLeftovers({ recorded, log = () => {} }) {
  const own = await sweepOwnNodeOrphans({
    recorded,
    excludePid: process.pid,
    log,
  });
  // Recorded like the chain's own exit purge: this is THE path that runs when
  // a run is killed from outside — the case the whole mechanism exists for,
  // and the one whose frequency we want to know.
  recordSweep({ origin: 'guard', ...own });
  const older = await sweepOrphanNodeProcesses({});
  return { ...own, older };
}

/**
 * Poll the parent pid, RECORD its descendants while it lives, and purge the
 * recorded ones once it is gone.
 * Resolves with 'swept', 'timeout' or 'invalid-pid'; never rejects.
 * All collaborators are injectable so the policy is unit-testable without
 * spawning anything.
 * @param {{ parentPid?: number, pollMs?: number, snapshotMs?: number,
 *   maxMs?: number, isAlive?: (pid: number) => boolean,
 *   snapshot?: () => Promise<{ pid: number, name: string, born: string }[] | null>,
 *   sweep?: (info: { recorded: { pid: number, name: string, born: string }[] }) => unknown,
 *   sleep?: (ms: number) => Promise<void> }} options
 */
export async function watchParentAndSweep({
  parentPid,
  pollMs = POLL_MS,
  snapshotMs = SNAPSHOT_MS,
  maxMs = MAX_MS,
  isAlive = defaultIsAlive,
  snapshot,
  sweep,
  sleep = wait,
} = {}) {
  if (!Number.isInteger(parentPid) || parentPid <= 0) return 'invalid-pid';

  const takeSnapshot = snapshot ?? (() => snapshotDescendants({ rootPids: [parentPid] }));
  // pid → { pid, name, born } : what the chain created, learned while it could
  // still be learned. Once the chain dies this knowledge is all we have.
  const known = new Map();
  const remember = (entries) => {
    for (const e of entries ?? []) {
      if (e && Number.isInteger(e.pid) && e.pid > 0 && typeof e.born === 'string') known.set(e.pid, e);
    }
  };
  const runSweep = async () => {
    const recorded = [...known.values()];
    if (sweep) return sweep({ recorded });
    return sweepChainLeftovers({ recorded, log: () => {} });
  };

  const checks = Math.max(1, Math.ceil(maxMs / pollMs));
  await sleep(pollMs);
  let nextSnapshotAt = 0;
  for (let i = 0; i < checks; i++) {
    if (!isAlive(parentPid)) {
      // Let the external kill finish tearing the tree down, then clean up.
      await sleep(pollMs);
      try {
        await runSweep();
      } catch {
        /* best-effort cleaner: a failed sweep must never surface */
      }
      return 'swept';
    }
    // The chain is alive: this is the only moment its descendants can be found
    // by lineage, so record them before that knowledge is lost.
    if (Date.now() >= nextSnapshotAt) {
      nextSnapshotAt = Date.now() + snapshotMs;
      try {
        remember(await takeSnapshot());
      } catch {
        /* best-effort recorder: a failed snapshot must never surface */
      }
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
      const guard = spawn(process.execPath, [fileURLToPath(import.meta.url), String(Number(args[1]))], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      guard.unref();
    } catch {
      /* nothing we can do — the chain's own end-of-run purge still runs */
    }
    process.exit(0);
  }
  watchParentAndSweep({ parentPid: Number(args[0]) }).then(() => process.exit(0));
}