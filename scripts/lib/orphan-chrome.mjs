// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/orphan-chrome.mjs — startup sweeps for orphaned processes AND
// leftover per-run temp profiles from interrupted verify runs: puppeteer
// Chrome AND the packaged Electron app.
//
// A verify script interrupted mid-run (OOM, timeout, killed CI job, Ctrl-C)
// leaves BOTH its processes and its per-run temp profile behind: puppeteer's
// headless Chrome (.../puppeteer_dev_chrome_profile-*) or the packaged app
// (portable stub — the historical "8 orphan MamaTheraFinance.exe" incident)
// with its --user-data-dir=.../electron-proof-ud-* profile. On this Windows
// machine a pile-up saturates the msys fork table (every node script fork
// has to copy them) and was a root cause of the push-hook fork panics. The
// launching scripts sweep them at STARTUP, before opening their own process:
// kill the orphan processes first, then remove the leftover profile dirs
// (a live process locks its dir, so deletion only happens after the kill).
//
// Safety:
//   - Windows only (the only platform where the orphans accumulate and hurt;
//     CI runners are ephemeral, and on POSIX the child-exit handling already
//     reaps them).
//   - Chrome: strict command-line marker (puppeteer_dev profile) — a normal
//     user Chrome session never matches and is never touched. Only matching
//     temp DIRS under the OS temp dir are removed (puppeteer_dev* —
//     puppeteer's synthetic per-run profiles, incl. e2e-business's
//     puppeteer_dev-e2e-*; verify-pdf-* — verify-pdf-download's work
//     dir), never a real user profile.
//   - Electron: our runs always pass --user-data-dir=<tmp>/electron-proof-*
//     (marker, killed regardless of age); other MamaTheraFinance.exe
//     processes (e.g. a legitimately open app) are only swept past a minimum
//     age window, so a freshly-started legit instance is never touched. The
//     matching electron-proof-* temp dirs (user-data, downloads, updater
//     profile) and the updater-proof-*.log proof log are per-run proof
//     artifacts — always safe to remove.
//   - Best-effort + bounded: any failure or >20 s stall resolves to 0
//     without blocking the caller; dir removal retries briefly to ride out
//     transient Windows file locks (a just-killed process releases its
//     handles within a second) before giving up.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';
import { readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Systematic retry for the powershell spawn itself: on this machine the
// transient msys fork panics (documented in DEVELOPMENT_HISTORY.md — "bruit
// machine") hit ANY external command including powershell; a single-shot
// spawn would then silently no-op the sweep. Retry a few times, spaced,
// before giving up — bounded, never blocks the caller.
const SWEEP_SPAWN_ATTEMPTS = 3;
const SWEEP_SPAWN_RETRY_MS = 400;

function runPowershellSweep(script, timeoutMs) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(0);
      return;
    }
    let attempt = 0;
    let settled = false;
    const settle = (n) => {
      if (!settled) {
        settled = true;
        resolve(n);
      }
    };
    const tryOnce = () => {
      attempt++;
      const child = spawn('powershell', ['-NoProfile', '-Command', script], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let out = '';
      let done = false;
      child.stdout.on('data', (d) => { out += d; });
      const timer = setTimeout(() => { child.kill(); done = true; settle(0); }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        if (attempt < SWEEP_SPAWN_ATTEMPTS) {
          setTimeout(tryOnce, SWEEP_SPAWN_RETRY_MS);
        } else {
          settle(0);
        }
      });
      child.on('close', () => {
        clearTimeout(timer);
        if (done) return;
        done = true;
        const n = parseInt((out.match(/\d+/) || ['0'])[0], 10);
        settle(Number.isFinite(n) ? n : 0);
      });
    };
    tryOnce();
  });
}

const PUPPETEER_SWEEP_SCRIPT =
  "$c = @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'puppeteer_dev' }); foreach ($p in $c) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; $c.Count";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Remove leftover per-run proof artifacts under the OS temp dir (Windows
 * only) — profile dirs AND log files. Strict prefixes only — never a real
 * user profile. Best-effort + bounded: per-artifact retries ride out
 * transient locks left by a just-killed process; the whole pass gives up at
 * the deadline and never throws. Returns the number of artifacts removed.
 */
export async function removeLeftoverTempArtifacts(prefixes, deadlineMs = 10000) {
  if (process.platform !== 'win32') return 0;
  const tmp = tmpdir();
  let entries;
  try {
    entries = readdirSync(tmp);
  } catch {
    return 0;
  }
  const deadline = Date.now() + deadlineMs;
  let removed = 0;
  for (const name of entries) {
    if (Date.now() >= deadline) break;
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    const dir = join(tmp, name);
    for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        removed++;
        break;
      } catch {
        // verrou transitoire (processus en cours d'extinction) — réessayer
        if (attempt < 2) await wait(400);
      }
    }
  }
  if (removed > 0) {
    console.log(`🧹 ${removed} artefact(s) temp résiduel(s) de preuve purgé(s) (${prefixes.join(', ')})`);
  }
  return removed;
}

/**
 * Kill leftover puppeteer Chrome processes AND remove their leftover temp
 * profiles + verify-pdf work dirs (Windows only). Returns the number of
 * processes killed.
 */
export async function sweepOrphanPuppeteer(timeoutMs = 20000) {
  const killed = await runPowershellSweep(PUPPETEER_SWEEP_SCRIPT, timeoutMs);
  await removeLeftoverTempArtifacts(['puppeteer_dev', 'verify-pdf-']);
  return killed;
}

/**
 * Kill orphaned MamaTheraFinance.exe processes AND remove the leftover
 * electron-proof-* profile dirs + updater-proof-* logs (Windows only).
 *
 * Two discriminators, applied per process:
 *   - our own runs always launch with --user-data-dir=...electron-proof-ud-*
 *     → killed regardless of age;
 *   - any other instance (e.g. a legitimately open app) is killed only past
 *     the minimum age window, protecting a freshly-started legit process.
 * Returns the number of processes killed; never rejects.
 */
export async function sweepOrphanElectron({ minAgeMinutes = 5, timeoutMs = 20000 } = {}) {
  const script =
    `$cut = (Get-Date).AddMinutes(-${minAgeMinutes}); ` +
    `$c = @(Get-CimInstance Win32_Process -Filter "Name='MamaTheraFinance.exe'"); ` +
    `$k = 0; foreach ($p in $c) { ` +
    `$ours = $p.CommandLine -match 'electron-proof-ud'; ` +
    `$old = ($null -ne $p.CreationDate) -and ($p.CreationDate -lt $cut); ` +
    `if ($ours -or $old) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $k++ } }; $k`;
  const killed = await runPowershellSweep(script, timeoutMs);
  await removeLeftoverTempArtifacts(['electron-proof-', 'updater-proof-']);
  return killed;
}