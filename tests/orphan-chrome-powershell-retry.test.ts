// Suite for scripts/lib/orphan-chrome.mjs — the systematic retry of the
// PowerShell spawn itself (the msys fork-panic "bruit machine" mitigation:
// a transient uv_spawn failure must not silently no-op the sweep).
//
// node:child_process is module-mocked (a controllable fake spawn) BEFORE the
// import, so no real powershell ever runs. node:fs/node:os are mocked too so
// the trailing removeLeftoverTempArtifacts pass stays in the fake temp. Mock
// timers keep the 400 ms retry spacing instant. Plain-node suite.
//
// The sweeps are Windows-only: `platform: 'win32'` is injected explicitly so
// the real retry branch runs on every CI OS (Linux runners included) instead
// of silently no-op'ing through the module's host-platform gate.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ── Mocked child_process state ───────────────────────────────────────────────
/** Per-spawn behavior: 'error' → emit error, else emit close with `out`. */
type SpawnPlan = { mode: 'error' | 'ok'; out?: string };
let plan: SpawnPlan[] = [];
let spawnCount = 0;
let killCount = 0;

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  kill() {
    killCount++;
  }
}

mock.module('node:child_process', {
  exports: {
    spawn: () => {
      spawnCount++;
      const child = new FakeChild();
      const next = plan.shift() ?? { mode: 'ok', out: '0' };
      if (next.mode === 'error') {
        queueMicrotask(() => child.emit('error', new Error('uv_spawn: EUNKNOWN')));
      } else {
        queueMicrotask(() => {
          child.stdout.emit('data', next.out ?? '0');
          child.emit('close', 0);
        });
      }
      return child;
    },
  },
});
mock.module('node:os', {
  exports: { tmpdir: () => 'C:/fake/temp' },
});
mock.module('node:fs', {
  exports: {
    readdirSync: () => [],
    rmSync: () => {},
  },
});

const { sweepOrphanPuppeteer, sweepOrphanElectron } =
  await import('../scripts/lib/orphan-chrome.mjs');

describe('sweepOrphanPuppeteer — retry systématique du spawn powershell', () => {
  beforeEach(() => {
    plan = [];
    spawnCount = 0;
    killCount = 0;
  });

  it('échec de spawn transitoire → réessaie puis compte le résultat', async (t) => {
    plan = [
      { mode: 'error' },
      { mode: 'ok', out: '3' },
    ];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sweepOrphanPuppeteer(1000, 'win32');
      await Promise.resolve(); // laisse la microtask 'error' programmer le retry
      t.mock.timers.tick(400); // espacement du 1er retry
      const n = await p;
      assert.equal(n, 3, 'le résultat du 2e spawn est utilisé');
      assert.equal(spawnCount, 2, 'un seul retry après l’échec');
    } finally {
      t.mock.timers.reset();
    }
  });

  it('échecs persistants → 0 sans jamais lever, après 3 tentatives bornées', async (t) => {
    plan = [{ mode: 'error' }, { mode: 'error' }, { mode: 'error' }];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sweepOrphanPuppeteer(1000, 'win32');
      for (let i = 0; i < 2; i++) {
        await Promise.resolve(); // microtask 'error' → programme le retry
        t.mock.timers.tick(400); // déclenche le retry suivant
      }
      const n = await p;
      assert.equal(n, 0);
      assert.equal(spawnCount, 3, 'exactement SWEEP_SPAWN_ATTEMPTS tentatives');
    } finally {
      t.mock.timers.reset();
    }
  });

  it('succès direct → un seul spawn, résultat lu sur stdout', async (t) => {
    plan = [{ mode: 'ok', out: '5' }];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const n = await sweepOrphanPuppeteer(1000, 'win32');
      assert.equal(n, 5);
      assert.equal(spawnCount, 1);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('sweepOrphanElectron hérite du même retry', async (t) => {
    plan = [
      { mode: 'error' },
      { mode: 'ok', out: '2' },
    ];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = sweepOrphanElectron({ platform: 'win32' });
      await Promise.resolve();
      t.mock.timers.tick(400);
      const n = await p;
      assert.equal(n, 2);
      assert.equal(spawnCount, 2);
    } finally {
      t.mock.timers.reset();
    }
  });
});