#!/usr/bin/env node
/**
 * Panic doctor — what is this machine actually doing, in one command?
 *
 *   npm run orphans:doctor            (or: node scripts/panic-doctor.mjs)
 *   npm run orphans:doctor -- --json  (machine-readable, for an agent/CI)
 *   npm run orphans:doctor -- --strict (exit 2 when a finding is an alarm)
 *
 * Read-only by design: it prints the state and the command that would act on
 * it. The purge and the doctor are separate on purpose — a doctor that fixes
 * things while it diagnoses hides the state you were trying to see (see
 * scripts/lib/panic-doctor.mjs).
 *
 * It answers the four questions the panic raised by hand for months:
 *   1. which node.exe exist, how old they are, and whose parent is gone;
 *   2. which of them the sweep considers a quality-chain leftover (its own
 *      definition, shared — never a second, drifting copy of the filter);
 *   3. which detached guards are alive, and whether what they watch is still
 *      running (a guard watching a dead pid should have exited);
 *   4. what the journal measured: purges (zeros included) and the panics
 *      themselves, over the last 24 h.
 */
import { spawnSync } from 'node:child_process';
import { readSweepLog } from './lib/orphan-node.mjs';
import {
  buildMachineSnapshotScript,
  diagnose,
  formatDiagnosis,
  parseMachineSnapshot,
} from './lib/panic-doctor.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const strict = args.includes('--strict');

/**
 * Snapshot the machine. A failure is reported as a partial inventory rather
 * than thrown: the journal part of the diagnosis is still worth printing — and
 * a diagnosis that cannot run is exactly what the panic looks like.
 */
function snapshot(platform = process.platform) {
  if (platform !== 'win32') return { processes: [], memory: {}, warning: null, unsupported: true };
  const result = spawnSync('powershell', ['-NoProfile', '-Command', buildMachineSnapshotScript()], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  if (!result.stdout) {
    return {
      processes: [],
      memory: {},
      warning: (result.stderr || `powershell exit ${result.status}`).toString().trim().slice(0, 300),
    };
  }
  return { ...parseMachineSnapshot(result.stdout), warning: null };
}

const snap = snapshot();
const journal = readSweepLog();
const nowMs = Date.now();
const diagnosis = diagnose({ ...snap, journal, nowMs });

if (asJson) {
  console.log(JSON.stringify({ at: new Date(nowMs).toISOString(), ...diagnosis }, null, 2));
  process.exit(strict && diagnosis.verdicts.some((v) => v.level === 'alarm') ? 2 : 0);
}

for (const line of formatDiagnosis(diagnosis, { nowMs })) console.log(line);
if (snap.unsupported) {
  console.log('ℹ️  Inventaire des processus : Windows uniquement — seul le journal est affiché ici.');
}
if (snap.warning) {
  console.log(`⚠️  Inventaire incomplet — powershell n’a pas répondu (fork-panic ?) : ${snap.warning}`);
}

process.exit(strict && diagnosis.verdicts.some((v) => v.level === 'alarm') ? 2 : 0);
