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

// `namedExports` et non `exports` : sur Node 22 (le runtime de la CI) mocker un
// module BUILTIN via `exports` seul casse l'interop ESM (« The requested module
// 'node:child_process' does not provide an export named 'spawn' »), et Node 24
// refuse les deux options ensemble.
mock.module('node:child_process', {
  namedExports: {
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

// `platform: 'win32'` est injecté pour que le sweep (mocké) produise les mêmes
// spawns que sur les machines de dev Windows : hérité, il serait un no-op sur
// un runner Linux et les assertions d'ordre sweep/chaîne seraient vides.
const quiet = { log: () => {}, forwardStderr: false, platform: 'win32' as const };
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

  it('succès direct → sweep AVANT la 1re tentative puis un seul spawn de chaîne, exit 0', async () => {
    plan = [{ mode: 'close', code: 0 }];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawns.length, 2, 'sweep + chaîne');
    assert.ok(isSweep(spawns[0]), 'le sweep passe avant la 1re tentative');
    assert.ok(isChain(spawns[1]), 'la chaîne qualité est lancée');
    assert.deepEqual(
      spawns[1].opts.stdio,
      ['inherit', 'inherit', 'pipe'],
      'spawn-only, seuls stdout/stderr sont capturés',
    );
  });

  it('fork-panic (exit 254) → sweep avant la 1re tentative, entre les retries, puis succès', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 0 },
    ];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawns.length, 4, 'sweep + chaîne + sweep + chaîne');
    assert.ok(isSweep(spawns[0]));
    assert.ok(isChain(spawns[1]));
    assert.ok(isSweep(spawns[2]), 'le sweep orphelins passe entre les tentatives');
    assert.ok(isChain(spawns[3]));
  });

  it('échec réel (exit 1, stderr propre) → AUCUN retry, code passé à git tel quel', async () => {
    plan = [{ mode: 'close', code: 1, stderr: 'ESLint: 3 errors\n' }];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 1);
    assert.equal(spawns.filter(isChain).length, 1, 'pas de retry sur un échec réel');
    assert.equal(spawns.filter(isSweep).length, 1, 'le sweep avant la 1re tentative a bien eu lieu');
  });

  it('fork-panic persistant → borné à `attempts`, dernier code retourné', async () => {
    plan = [
      { mode: 'close', code: 254 },
      { mode: 'close', code: 254 },
      { mode: 'close', code: 254 },
    ];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 254);
    assert.equal(spawns.length, 6, 'sweep avant + 3 tentatives chaîne + 2 sweeps intercalés');
    assert.equal(spawns.filter(isChain).length, 3);
    assert.equal(spawns.filter(isSweep).length, 3);
  });

  it('steps par défaut → lint test audit (pre-commit ET pre-push)', async () => {
    plan = [{ mode: 'close', code: 0 }];
    await runHookQualityChain({ ...quiet, attempts: 1, waitMs: 1 });
    const chain = spawns.find(isChain);
    assert.ok(chain, 'la chaîne qualité est lancée');
    assert.deepEqual(chain.args.slice(1), ['lint', 'test', 'audit']);
  });

  it('steps personnalisés (ex. pre-push allégé) → transmis à la chaîne', async () => {
    plan = [{ mode: 'close', code: 0 }];
    await runHookQualityChain({ ...quiet, attempts: 1, waitMs: 1, steps: ['l10n'] });
    const chain = spawns.find((s) => s.cmd === process.execPath && s.args[1] === 'l10n');
    assert.ok(chain, 'la chaîne reçoit les étapes demandées');
    assert.deepEqual(chain.args.slice(1), ['l10n']);
  });

  it('steps vide → retour aux étapes par défaut (jamais 0 étape)', async () => {
    plan = [{ mode: 'close', code: 0 }];
    await runHookQualityChain({ ...quiet, attempts: 1, waitMs: 1, steps: [] });
    const chain = spawns.find(isChain);
    assert.ok(chain);
    assert.deepEqual(chain.args.slice(1), ['lint', 'test', 'audit']);
  });

  it('sweepAll → purge élargie (tous les node.exe orphelins) avant la 1re tentative', async () => {
    plan = [{ mode: 'close', code: 0 }];
    const code = await runHookQualityChain({ ...quiet, attempts: 1, waitMs: 1, sweepAll: true });
    assert.equal(code, 0);
    assert.equal(spawns.length, 2, 'sweep élargi + chaîne');
    assert.ok(isSweep(spawns[0]));
    assert.doesNotMatch(spawns[0].args.join(' '), /quality-chain/);
    assert.match(spawns[0].args.join(' '), /\$eligible = \$parentGone;/);
    assert.ok(isChain(spawns[1]));
  });

  it('uv_spawn EUNKNOWN en plein run → sweep avant, sweep intercalé, puis succès', async () => {
    plan = [
      { mode: 'error', message: 'uv_spawn: EUNKNOWN' },
      { mode: 'close', code: 0 },
    ];
    const code = await runHookQualityChain({ ...quiet, attempts: 3, waitMs: 1 });
    assert.equal(code, 0);
    assert.equal(spawns.length, 4);
    assert.ok(isSweep(spawns[0]));
    assert.ok(isChain(spawns[1]));
    assert.ok(isSweep(spawns[2]));
    assert.ok(isChain(spawns[3]));
  });
});