/**
 * Kill orphaned node.exe processes.
 *
 * Background servers/watchers started from a terminal that later dies (or is
 * killed by an app restart) leave node.exe children behind. Each fork from an
 * msys/Git-Bash shell must copy the cygheap over every one of those children,
 * so a pile-up saturates the fork table and bash starts failing with:
 *
 *   cygheap read copy failed ... Win32 error 299
 *   fork: retry: Resource temporarily unavailable
 *
 * This script enumerates node.exe processes, protects the current process and
 * its whole ancestor chain (the bash -> npm -> node invocation that runs it),
 * and force-kills every other node.exe. The current command tree survives; a
 * real dev server running in another terminal does NOT — run it only when the
 * fork table is the problem, exactly as it is designed to be used before a
 * heavy `npm test` after a crashed dev session.
 *
 * Usage:
 *   node scripts/kill-orphan-node.mjs            # kill them
 *   node scripts/kill-orphan-node.mjs --dry-run  # list without killing
 */

import { execFileSync } from 'node:child_process';

const DRY_RUN = process.argv.includes('--dry-run');

const PS_QUERY =
  'Get-CimInstance Win32_Process | ' +
  'Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json -Compress';

let rows;
try {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', PS_QUERY], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  rows = JSON.parse(out.trim());
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
} catch (err) {
  console.error(`Failed to enumerate processes: ${err.message}`);
  process.exit(1);
}

const parentOf = new Map(rows.map((r) => [r.ProcessId, r.ParentProcessId]));

// Protect the current process and its full ancestor chain so the script's own
// bash -> npm -> node command tree is never killed.
const protectedPids = new Set([process.pid]);
let cursor = process.pid;
while (cursor && parentOf.has(cursor)) {
  const parent = parentOf.get(cursor);
  if (!parent || parent === cursor || protectedPids.has(parent)) break;
  protectedPids.add(parent);
  cursor = parent;
}

const targets = rows.filter(
  (r) => r.Name === 'node.exe' && !protectedPids.has(r.ProcessId),
);

if (targets.length === 0) {
  console.log('No orphaned node.exe processes found. Fork table should be healthy.');
  process.exit(0);
}

console.log(
  `${DRY_RUN ? '[dry-run] would kill' : 'Killing'} ${targets.length} orphaned node.exe process(es):`,
);
for (const t of targets) console.log(`  PID ${t.ProcessId}`);

if (DRY_RUN) process.exit(0);

for (const t of targets) {
  try {
    execFileSync('taskkill', ['/PID', String(t.ProcessId), '/F', '/T'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } catch {
    // Already gone or access denied — nothing to do.
  }
}
console.log('Done.');