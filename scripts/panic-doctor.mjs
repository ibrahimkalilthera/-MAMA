#!/usr/bin/env node
/**
 * Panic doctor — what is this machine actually doing, in one command?
 *
 *   npm run orphans:doctor            (or: node scripts/panic-doctor.mjs)
 *   npm run orphans:doctor -- --json  (machine-readable, for an agent/CI)
 *   npm run orphans:doctor -- --strict (exit 2 when a finding is an alarm)
 *   npm run orphans:doctor -- --fix   (apply the remedies it named, one at a time)
 *   npm run orphans:doctor -- --fix --yes (same, without asking — for a script)
 *
 * Read-only by DEFAULT: it prints the state and the command that would act on
 * it. `--fix` is an explicit SECOND pass that runs after the diagnosis has been
 * printed, so the state you came to see is never hidden by the repair — and it
 * asks before every step. What it may touch is deliberately narrow (husky
 * launchers, `core.hooksPath`, the pin's entries in node_modules/.bin):
 * mechanical, local, idempotent. It never kills anything — the sweep stays a
 * separate, deliberate command (see scripts/lib/panic-doctor.mjs).
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
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readSweepLog } from './lib/orphan-node.mjs';
import {
  BIN_SHIM_DIR,
  BIN_SHIM_NAMES,
  HOOK_NAMES,
  buildMachineSnapshotScript,
  diagnose,
  formatDiagnosis,
  inspectBinShims,
  inspectHooks,
  parseMachineSnapshot,
  planRemedies,
} from './lib/panic-doctor.mjs';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const strict = args.includes('--strict');
const fix = args.includes('--fix');
// `--yes` exists so the same repairs can run from a script (and from a suite);
// the default stays "ask before each step".
const assumeYes = args.includes('--yes');

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

/**
 * Read the hook installation: `core.hooksPath` from git itself, the tracked
 * hook files, and husky's launchers (what git actually runs). Read-only; a
 * missing piece is data, not an exception.
 */
function readHookState({ cwd = process.cwd() } = {}) {
  const config = spawnSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8', cwd, windowsHide: true });
  const hooks = {};
  for (const name of HOOK_NAMES) {
    try {
      hooks[name] = readFileSync(join(cwd, '.husky', name), 'utf8');
    } catch {
      /* missing hook: reported as absent, not thrown */
    }
  }
  let launchers;
  try {
    launchers = readdirSync(join(cwd, '.husky', '_'));
  } catch {
    launchers = [];
  }
  return inspectHooks({ hooksPath: (config.stdout || '').trim(), hooks, launchers });
}

/**
 * Read the pin's entries in node_modules/.bin — both spellings (the posix shim
 * and the `.cmd` one) concatenated, since either can be the one a shell picks.
 * Read-only; a missing file is data, like the hooks.
 */
function readBinShims({ root = process.cwd() } = {}) {
  const shims = {};
  for (const name of BIN_SHIM_NAMES) {
    const parts = [];
    for (const file of [name, `${name}.cmd`]) {
      try {
        parts.push(readFileSync(join(root, BIN_SHIM_DIR, file), 'utf8'));
      } catch {
        /* absent: reported, not thrown */
      }
    }
    shims[name] = parts.join('\n');
  }
  return inspectBinShims({ shims, exists: existsSync, dir: BIN_SHIM_DIR });
}

/**
 * Run ONE remedy. `node` is replaced by the runtime executing the doctor, so a
 * repair runs on the same node as the diagnosis that prescribed it.
 */
function runRemedy(step) {
  const [command, ...rest] = step.cmd;
  const file = command === 'node' ? process.execPath : command;
  const started = Date.now();
  const result = spawnSync(file, rest, { stdio: 'inherit', windowsHide: true });
  return {
    ok: result.status === 0,
    status: result.status,
    ms: Date.now() - started,
    error: result.error ? result.error.message : null,
  };
}

/**
 * Apply the plan, asking before each step. Refusals are a normal outcome, not
 * an error: the doctor's job is to make the state and its repair visible, and
 * leaving a step alone must stay the easy choice.
 *
 * @param {{ id: string, title: string, detail: string, cmd: string[] }[]} steps
 */
async function applyRemedies(steps) {
  const { createInterface } = await import('node:readline/promises');
  const rl = assumeYes ? null : createInterface({ input: process.stdin, output: process.stdout });
  let applied = 0;
  let refused = 0;
  let failed = 0;
  if (!assumeYes && !process.stdin.isTTY) {
    console.log(
      'ℹ️  Entrée non interactive : répondez sur stdin (o/N par remède), ou relancez avec --yes.',
    );
  }
  try {
    for (const step of steps) {
      console.log(`\n🔧 ${step.title}`);
      console.log(`   ${step.detail}`);
      console.log(`   $ ${step.cmd.join(' ')}`);
      let answer = 'y';
      if (rl) {
        answer = await rl.question('   Appliquer ? [o/N] ');
      }
      if (!/^\s*(o|y)/i.test(answer)) {
        refused += 1;
        console.log('   ⏭️  refusé — aucun effet.');
        continue;
      }
      const result = runRemedy(step);
      if (result.error) {
        failed += 1;
        console.log(`   ❌ ${result.error}`);
      } else if (result.ok) {
        applied += 1;
        console.log(`   ✅ « ${step.id} » appliqué en ${result.ms}ms.`);
      } else {
        failed += 1;
        console.log(`   ❌ « ${step.id} » : exit ${result.status} en ${result.ms}ms.`);
      }
    }
  } finally {
    rl?.close();
  }
  console.log(
    `\n🩺 Remèdes : ${applied} appliqué(s), ${refused} refusé(s)` +
      (failed > 0 ? `, ${failed} en échec — relancez le docteur pour voir l’état.` : '.') +
      ' (le sweep reste un geste explicite : ce docteur ne tue rien.)',
  );
  return { applied, refused, failed };
}

const snap = snapshot();
const journal = readSweepLog();
const hooks = readHookState();
const binShims = readBinShims();
const nowMs = Date.now();
const diagnosis = diagnose({ ...snap, journal, hooks, binShims, nowMs });
const remedies = planRemedies(diagnosis);

if (asJson) {
  // JSON is the read-only surface: the plan is data (`remedies`), applying it is
  // not — an agent that wants to act reads the plan and runs its steps, with
  // its own confirmation policy.
  if (fix) {
    console.error('❌ --json et --fix sont incompatibles : --json décrit le plan, --fix l’applique.');
    process.exit(2);
  }
  console.log(
    JSON.stringify({ at: new Date(nowMs).toISOString(), ...diagnosis, remedies }, null, 2),
  );
  process.exit(strict && diagnosis.verdicts.some((v) => v.level === 'alarm') ? 2 : 0);
}

for (const line of formatDiagnosis(diagnosis, { nowMs })) console.log(line);
if (snap.unsupported) {
  console.log('ℹ️  Inventaire des processus : Windows uniquement — seul le journal est affiché ici.');
}
if (snap.warning) {
  console.log(`⚠️  Inventaire incomplet — powershell n’a pas répondu (fork-panic ?) : ${snap.warning}`);
}

// The plan is printed even without --fix: a remedy nobody can see is a remedy
// nobody runs. `--fix` is what turns these lines into a decision.
if (remedies.length > 0) {
  console.log(
    `\n🔧 ${remedies.length} remède(s) mécanique(s) — \`--fix\` les applique un par un, en demandant confirmation :`,
  );
  for (const step of remedies) console.log(`   • ${step.title} — \`${step.cmd.join(' ')}\``);
} else {
  console.log('\n🔧 Aucun remède mécanique : rien à restaurer ici.');
}

if (fix) {
  if (!process.stdin.isTTY && !assumeYes) {
    console.error('❌ --fix demande une confirmation interactive, ou --yes pour l’assumer.');
    process.exit(2);
  }
  await applyRemedies(remedies);
}

process.exit(strict && diagnosis.verdicts.some((v) => v.level === 'alarm') ? 2 : 0);
