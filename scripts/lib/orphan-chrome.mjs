// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/orphan-chrome.mjs — startup sweep for orphan puppeteer Chrome.
//
// A verify script interrupted mid-run (OOM, timeout, killed CI job, Ctrl-C)
// leaves its headless Chrome behind: puppeteer's temp profile lives under
// .../puppeteer_dev_XXXX and the process keeps running with no owner. On
// this Windows machine a pile-up of such orphans saturates the msys fork
// table (every node script fork has to copy them) and was a root cause of
// the push-hook fork panics. The Chrome-launching scripts sweep them at
// STARTUP, before opening their own browser.
//
// Safety:
//   - Windows only (the only platform where the orphans accumulate and hurt;
//     CI runners are ephemeral, and on POSIX puppeteer's SIGTERM/child exit
//     handling already reaps them).
//   - Matches strictly: chrome.exe processes whose command line contains the
//     puppeteer_dev profile marker. A normal user Chrome session never
//     matches and is never touched.
//   - Best-effort + bounded: any failure or >20 s stall resolves to 0
//     without blocking the caller.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process';

const POWERSHELL_SWEEP = [
  '-NoProfile', '-Command',
  "$c = @(Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'puppeteer_dev' }); foreach ($p in $c) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue }; $c.Count",
];

/**
 * Kill leftover puppeteer Chrome processes (Windows only).
 * Resolves to the number of orphans killed; never rejects.
 */
export function sweepOrphanPuppeteer(timeoutMs = 20000) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(0);
      return;
    }
    const child = spawn('powershell', POWERSHELL_SWEEP, {
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