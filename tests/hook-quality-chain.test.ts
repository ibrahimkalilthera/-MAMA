// Suite for scripts/hook-quality-chain.mjs — runHookQualityChain().
//
// node:child_process is module-mocked (a controllable fake spawn) BEFORE the
// import, so no real chain ever runs. Proves the policy:
//   - the chain is spawned spawn-only (node via CreateProcess, stdio
//     inherit/inherit/pipe — nothing for msys to fork);
//   - a panic signature (exit 254/66) triggers the orphan sweep BETWEEN
//     attempts, never before the first run;
//   - a real chain failure (exit 1, clean stderr) is never retried and its
//     code passes straight through to git;
//   - retries are bounded by `attempts`.
// Plain-node suite (no DOM, no network).
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Mocked child_process state ───────────────────────────────────────────────
type ClosePlan = { mode: 'close'; code: number; stderr?: string; stdout?: string };
type ErrorPlan = { mode: 'error'; message: string };
type Plan = ClosePlan | ErrorPlan;
let plan: Plan[] = [];
let spawns: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];

class FakeChild extends EventEmitter {
  pid = 4242;
  stderr = new EventEmitter();
  stdout = new EventEmitter();
  kill() {
    /* recorded via spawns only */
  }
}

mock.module('node:child_process', {
  exports: {
    spawn: (cmd: string, args: string[], opts: Record<string, unknown> = {}) => {
      spawns.push({ cmd, args, opts });
      const child = new FakeChild();
      // The sweep (powershell) always succeeds and must not consume a plan
      // entry — only the chain spawns are scripted.
      const next: Plan =
        cmd === 'powershell'
          ? { mode: 'close', code: 0 }
          : plan.shift() ?? { mode: 'close', code: 0 };
      if (next.mode === 'error') {
        queueMicrotask(() => child.emit('error', new Error(next.message)));
      } else {
        queueMicrotask(() => {
          if (next.stderr) child.stderr.emit('data', next.stderr);
          if (next.stdout) child.stdout.emit('data', next.stdout);
          child.emit('close', next.code);
        });
      }
      return child;
    },
    // Provided so the git-retry import (spawnSync for resolveGit) loads; the
    // hook chain itself never calls it.
    spawnSync: (_cmd: string, _args: string[]) => ({
      status: 0,
      stdout: '',
      stderr: '',
    }),
  },
});

const { runHookQualityChain } = await import('../scripts/hook-quality-chain.mjs');

const quiet = { log: () => {}, forwardStderr: false };
const isChain = (s: { cmd: string; args: string[] }) =>
  s.cmd === process.execPath &&
  s.args[0] === 'scripts/quality-chain.mjs' &&
  s.args[1] === 'lint' &&
  s.args[2] === 'test' &&
  s.args[3] === 'audit';
const isSweep = (s: { cmd: string }) => s.cmd === 'powershell';

describe('runHookQualityChain', () => {
  beforeEach(() => {
    plan = [];
    spawns = [];
  });

  it('succès direct → un seul spawn de la chaîne, AUCUN sweep, exit 0', async () => {
    plan = [{ mode: 'close', code: 0 }];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawns.length, 1, 'un seul spawn');
    assert.ok(isChain(spawns[0]), 'la chaîne qualité est lancée');
    assert.deepEqual(
      spawns[0].opts.stdio,
      ['inherit', 'inherit', 'pipe'],
      'spawn-only, seuls stdout/stderr sont capturés',
    );
  });

  it('fork-panic (exit 254) → sweep entre les tentatives puis succès', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 0 },
    ];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawns.length, 3, 'chaîne + sweep + chaîne');
    assert.ok(isChain(spawns[0]));
    assert.ok(isSweep(spawns[1]), 'le sweep orphelins passe entre les tentatives');
    assert.ok(isChain(spawns[2]));
  });

  it('échec réel (exit 1, stderr propre) → AUCUN retry, code passé à git tel quel', async () => {
    plan = [{ mode: 'close', code: 1, stderr: 'ESLint: 3 errors\n' }];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 1);
    assert.equal(spawns.length, 1, 'pas de retry sur un échec réel');
  });

  it('fork-panic persistant → borné à `attempts`, dernier code retourné', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 254 },
      { mode: 'close', code: 254 },
    ];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 254);
    assert.equal(spawns.length, 5, '3 tentatives chaîne + 2 sweeps intercalés');
    assert.equal(spawns.filter(isChain).length, 3);
    assert.equal(spawns.filter(isSweep).length, 2);
  });

  it('uv_spawn EUNKNOWN en plein run → sweep puis retry', async () => {
    plan = [
      { mode: 'error', message: 'uv_spawn: EUNKNOWN' },
      { mode: 'close', code: 0 },
    ];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawns.length, 3);
    assert.ok(isChain(spawns[0]));
    assert.ok(isSweep(spawns[1]));
    assert.ok(isChain(spawns[2]));
  });
});