// Suite for scripts/lib/orphan-guard.mjs — watchParentAndSweep() +
// spawnOrphanGuard().
//
// node:child_process is module-mocked BEFORE the import, so spawnOrphanGuard
// can be verified without launching anything (the guard itself must be
// detached + unref'd, spawned as the `--relay` entry point). The watching
// policy is tested with injected collaborators: no polling, no real processes,
// no real sweep.
// Plain-node suite.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mockModule } from './module-mock';

// ── Mocked child_process state ───────────────────────────────────────────────
let spawnCalls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
let unrefCalls = 0;

class FakeChild extends EventEmitter {
  pid = 4242;
  unref() {
    unrefCalls++;
  }
}

// Mocker un module dépend du majeur qui exécute la suite (le nom de l’option a
// changé pour de bon en 24.20/25.9) : le nom est choisi par tests/module-mock.ts.
mockModule('node:child_process', {
  spawn: (cmd: string, args: string[], opts: Record<string, unknown> = {}) => {
    spawnCalls.push({ cmd, args, opts });
    return new FakeChild();
  },
  // git-retry.mjs (imported for the sweep) also pulls spawnSync.
  spawnSync: () => ({ status: 0, stdout: '', stderr: '' }),
});

const { watchParentAndSweep, spawnOrphanGuard } =
  await import('../scripts/lib/orphan-guard.mjs');

const noSleep = async () => {};
// Aucun relevé réel : les tests n'invoquent jamais PowerShell.
const noSnapshot = async () => [];

describe('watchParentAndSweep', () => {
  it('parent déjà mort → sweep une fois, résultat « swept »', async () => {
    const events: string[] = [];
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      isAlive: () => false,
      snapshot: noSnapshot,
      sweep: async () => { events.push('sweep'); },
      sleep: noSleep,
    });
    assert.equal(result, 'swept');
    assert.deepEqual(events, ['sweep']);
  });

  it('parent vivant pendant toute la fenêtre → AUCUN sweep, résultat « timeout »', async () => {
    let sweeps = 0;
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      maxMs: 5,
      isAlive: () => true,
      snapshot: noSnapshot,
      sweep: async () => { sweeps++; },
      sleep: noSleep,
    });
    assert.equal(result, 'timeout');
    assert.equal(sweeps, 0, 'ne purge jamais tant que la chaîne tourne');
  });

  it('parent qui meurt après quelques polls → sweep une seule fois', async () => {
    let alive = 3;
    let sweeps = 0;
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      maxMs: 100,
      isAlive: () => alive-- > 0,
      snapshot: noSnapshot,
      sweep: async () => { sweeps++; },
      sleep: noSleep,
    });
    assert.equal(result, 'swept');
    assert.equal(sweeps, 1);
  });

  it('un sweep qui échoue est avalé (n’est jamais propagé)', async () => {
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      isAlive: () => false,
      snapshot: noSnapshot,
      sweep: async () => { throw new Error('powershell boom'); },
      sleep: noSleep,
    });
    assert.equal(result, 'swept');
  });

  it('enregistre les descendants PENDANT que la chaîne vit, et passe l’union à la purge', async () => {
    // Le relevé vit avec la chaîne pour que l'ensemble à tuer soit ancré dans
    // un arbre VIVANT : chaque cible est ensuite vérifiée contre l'horodatage
    // de création relevé ici, donc un pid recyclé ne peut pas passer pour un
    // nôtre. (La fermeture ParentProcessId survit, elle, à la mort de la
    // racine — mesuré — mais un walk post-mortem n'a plus rien pour authentifier
    // ce qu'il trouve.)
    let alive = 3;
    let snapshots = 0;
    const rounds = [
      [{ pid: 11, name: 'node.exe', born: 'b1' }, { pid: 12, name: 'cmd.exe', born: 'b2' }],
      [{ pid: 13, name: 'node.exe', born: 'b3' }],
    ];
    let recordedAtSweep: { pid: number }[] = [];
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      snapshotMs: 0, // un relevé à chaque poll
      maxMs: 100,
      isAlive: () => alive-- > 0,
      snapshot: async () => rounds[Math.min(snapshots++, rounds.length - 1)],
      sweep: async ({ recorded }: { recorded: { pid: number }[] }) => { recordedAtSweep = recorded; },
      sleep: noSleep,
    });
    assert.equal(result, 'swept');
    assert.ok(snapshots > 1, 'le relevé tourne plusieurs fois, pas une seule au démarrage');
    assert.deepEqual(recordedAtSweep.map((e) => e.pid).sort((a, b) => a - b), [11, 12, 13]);
  });

  it('un relevé qui échoue ne casse ni la veille ni la purge', async () => {
    let alive = 2;
    let sweeps = 0;
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      snapshotMs: 0,
      maxMs: 100,
      isAlive: () => alive-- > 0,
      snapshot: async () => { throw new Error('powershell boom'); },
      sweep: async () => { sweeps++; },
      sleep: noSleep,
    });
    assert.equal(result, 'swept');
    assert.equal(sweeps, 1);
  });

  it('un relevé « impossible » (null) n’ajoute rien mais n’interrompt rien', async () => {
    let alive = 2;
    let recordedAtSweep: unknown[] = [{}];
    const result = await watchParentAndSweep({
      parentPid: 4242,
      pollMs: 1,
      snapshotMs: 0,
      maxMs: 100,
      isAlive: () => alive-- > 0,
      snapshot: async () => null,
      sweep: async ({ recorded }: { recorded: unknown[] }) => { recordedAtSweep = recorded; },
      sleep: noSleep,
    });
    assert.equal(result, 'swept');
    assert.deepEqual(recordedAtSweep, []);
  });

  it('pid invalide → aucun poll, aucun sweep', async () => {
    let sweeps = 0;
    for (const parentPid of [0, -1, Number.NaN, undefined]) {
      const result = await watchParentAndSweep({
        parentPid: parentPid as number,
        isAlive: () => false,
        snapshot: noSnapshot,
        sweep: async () => { sweeps++; },
        sleep: noSleep,
      });
      assert.equal(result, 'invalid-pid');
    }
    assert.equal(sweeps, 0);
  });
});

describe('spawnOrphanGuard', () => {
  beforeEach(() => {
    spawnCalls = [];
    unrefCalls = 0;
  });

  it('sur Windows → relais détaché + unref (survit au taskkill de l’arbre)', () => {
    const ok = spawnOrphanGuard({
      parentPid: 777,
      platform: 'win32',
      execPath: 'C:\\node.exe',
      selfUrl: 'file:///C:/x/orphan-guard.mjs',
    });
    assert.equal(ok, true);
    assert.equal(spawnCalls.length, 1);
    assert.equal(spawnCalls[0].opts.detached, true);
    assert.equal(spawnCalls[0].opts.stdio, 'ignore');
    assert.deepEqual(spawnCalls[0].args.slice(-2), ['--relay', '777']);
    assert.equal(unrefCalls, 1, 'le relais ne bloque pas la chaîne');
  });

  it('hors Windows → aucun spawn', () => {
    const ok = spawnOrphanGuard({ parentPid: 777, platform: 'linux' });
    assert.equal(ok, false);
    assert.equal(spawnCalls.length, 0);
  });
});