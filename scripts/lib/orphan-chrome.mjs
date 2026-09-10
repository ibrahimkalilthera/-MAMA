// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/orphan-chrome.mjs — startup sweeps for orphaned processes left
// by interrupted verify runs: puppeteer Chrome AND the packaged Electron app.
//
// A verify script interrupted mid-run (OOM, timeout, killed CI job, Ctrl-C)
// leaves its processes behind: puppeteer's headless Chrome (temp profile
// .../puppeteer_dev_XXXX) or the packaged app (portable stub — the historical
// "8 orphan MamaTheraFinance.exe" incident). On this Windows machine a
// pile-up saturates the msys fork table (every node script fork has to copy
// them) and was a root cause of the push-hook fork panics. The launching
// scripts sweep them at STARTUP, before opening their own process.
//
// Safety:
//   - Windows only (the only platform where the orphans accumulate and hurt;
//     CI runners are ephemeral, and on POSIX the child-exit handling already
//     reaps them).
//   - Chrome: strict command-line marker (puppeteer_dev profile) — a normal
//     user Chrome session never matches and is never touched.
//   - Electron: our runs always pass --user-data-dir=<tmp>/electron-proof-ud-*
//     (marker, killed regardless of age); other MamaTheraFinance.exe
//     processes (e.g. a legitimately open app) are only swept past a minimum
//     age window, so a freshly-started legit instance is never touched.
//   - Best-effort + bounded: any failure or >20 s stall resolves to 0
//     without blocking the caller.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';

function runPowershellSweep(script, timeoutMs) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(0);
      return;
    }
    const child = spawn('powershell', ['-NoProfile', '-Command', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { child.kill(); resolve(0); }, timeoutMs);
    child.on('error', () => { clearTimeout(timer); resolve(0); });
    child.on('close', () => {
      clearTimeout(timer);
      const n = parseInt((out.match(/\d+/) || ['0'])[0], 10);
      resolve(Number.isFinite(n) ? n : 0);
    });
  });
}

const PUPPETEER_SWEEP_SCRIPT =
  "$c = @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'puppeteer_dev' }); foreach ($p in $c) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; $c.Count";

/** Kill leftover puppeteer Chrome processes (Windows only). Returns the count. */
export function sweepOrphanPuppeteer(timeoutMs = 20000) {
  return runPowershellSweep(PUPPETEER_SWEEP_SCRIPT, timeoutMs);
}

/**
 * Kill orphaned MamaTheraFinance.exe processes (Windows only).
 *
 * Two discriminators, applied per process:
 *   - our own runs always launch with --user-data-dir=...electron-proof-ud-*
 *     → killed regardless of age;
 *   - any other instance (e.g. a legitimately open app) is killed only past
 *     the minimum age window, protecting a freshly-started legit process.
 * Returns the number of processes killed; never rejects.
 */
export function sweepOrphanElectron({ minAgeMinutes = 5, timeoutMs = 20000 } = {}) {
  const script =
    `$cut = (Get-Date).AddMinutes(-${minAgeMinutes}); ` +
    `$c = @(Get-CimInstance Win32_Process -Filter "Name='MamaTheraFinance.exe'"); ` +
    `$k = 0; foreach ($p in $c) { ` +
    `$ours = $p.CommandLine -match 'electron-proof-ud'; ` +
    `$old = ($null -ne $p.CreationDate) -and ($p.CreationDate -lt $cut); ` +
    `if ($ours -or $old) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $k++ } }; $k`;
  return runPowershellSweep(script, timeoutMs);
}