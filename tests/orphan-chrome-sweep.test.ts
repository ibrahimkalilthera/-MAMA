// Suite for scripts/lib/orphan-chrome.mjs — removeLeftoverTempArtifacts().
//
// The helper reads tmpdir() (node:os) and readdirSync/rmSync (node:fs); both
// are module-mocked (node:test --experimental-test-module-mocks) BEFORE the
// import, so the suite never touches the real %TEMP% nor runs the PowerShell
// process sweeps. Mock timers keep the transient-lock retry waits instant.
// No DOM needed — plain-node suite (see tests/harness.ts "When NOT to use
// it": pure decision logic, no globals coupled).
//
// The helper is Windows-only: every call injects `platform: 'win32'` (and the
// no-op case `platform: 'linux'`) instead of inheriting the host OS, so the
// real win32 branch is exercised on every CI OS — Linux runners included.
import { beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';

// ── Mocked fs/os state ───────────────────────────────────────────────────────
const tmpPath = 'C:/fake/temp';
let entries: string[] = [];
let removed: string[] = [];
let readdirThrows = false;
/** path → number of consecutive rmSync failures to throw before succeeding. */
const failCounts = new Map<string, number>();
/** paths that always fail (locked forever). */
const alwaysFail = new Set<string>();

mock.module('node:os', {
  exports: {
    tmpdir: () => tmpPath,
  },
});
mock.module('node:fs', {
  exports: {
    readdirSync: () => {
      if (readdirThrows) throw new Error('EACCES');
      return entries;
    },
    rmSync: (p: string) => {
      if (alwaysFail.has(p)) throw new Error('EBUSY: répertoire verrouillé');
      const fails = failCounts.get(p) ?? 0;
      if (fails > 0) {
        failCounts.set(p, fails - 1);
        throw new Error('EBUSY: verrou transitoire');
      }
      removed.push(p);
    },
  },
});

const { removeLeftoverTempArtifacts } =
  await import('../scripts/lib/orphan-chrome.mjs');

describe('removeLeftoverTempArtifacts', () => {
  beforeEach(() => {
    entries = [];
    removed = [];
    readdirThrows = false;
    failCounts.clear();
    alwaysFail.clear();
  });

  it('ne supprime que les entrées au préfixe strict (jamais les autres)', async () => {
    entries = [
      'electron-proof-ud-1789000665349', // à supprimer
      'electron-proof-dl-1788999897324', // à supprimer
      'updater-proof-1789000000000.log', // à supprimer (fichier, pas un dossier)
      'puppeteer_dev_chrome_profile-1jshSY', // hors préfixes → intact
      'user-profile', // jamais touché
      'OtherStuff', // jamais touché
    ];
    const n = await removeLeftoverTempArtifacts(['electron-proof-', 'updater-proof-'], { platform: 'win32' });
    assert.equal(n, 3, 'seuls les artefacts au préfixe sont comptés');
    assert.deepEqual(removed, [
      join(tmpPath, 'electron-proof-ud-1789000665349'),
      join(tmpPath, 'electron-proof-dl-1788999897324'),
      join(tmpPath, 'updater-proof-1789000000000.log'),
    ]);
  });

  it('réessaie après un verrou transitoire (échec puis succès)', async (t) => {
    const target = join(tmpPath, 'electron-proof-ud-1');
    entries = ['electron-proof-ud-1'];
    failCounts.set(target, 1); // 1er rmSync échoue, le 2e passe
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = removeLeftoverTempArtifacts(['electron-proof-'], { platform: 'win32' });
      t.mock.timers.tick(400); // libère le wait du 1er échec
      const n = await p;
      assert.equal(n, 1);
      assert.deepEqual(removed, [target]);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('best-effort : échec permanent → 0 sans jamais lever', async (t) => {
    for (const e of ['electron-proof-ud-1', 'electron-proof-ud-2']) {
      alwaysFail.add(join(tmpPath, e));
    }
    entries = ['electron-proof-ud-1', 'electron-proof-ud-2'];
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = removeLeftoverTempArtifacts(['electron-proof-'], { platform: 'win32' });
      // 2 waits de 400ms par artefact (3 tentatives) → 4 waits au total.
      // `await` entre chaque tick laisse la continuation (microtask) du helper
      // s'exécuter et programmer le wait suivant.
      for (let i = 0; i < 4; i++) {
        t.mock.timers.tick(400);
        await Promise.resolve();
      }
      const n = await p;
      assert.equal(n, 0);
      assert.deepEqual(removed, []);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('best-effort : un artefact verrouillé ne bloque pas le suivant', async (t) => {
    const blocked = join(tmpPath, 'electron-proof-ud-1');
    const clean = join(tmpPath, 'electron-proof-ud-2');
    entries = ['electron-proof-ud-1', 'electron-proof-ud-2'];
    alwaysFail.add(blocked);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const p = removeLeftoverTempArtifacts(['electron-proof-'], { platform: 'win32' });
      for (let i = 0; i < 2; i++) {
        t.mock.timers.tick(400); // waits de l'artefact 1
        await Promise.resolve();
      }
      const n = await p;
      assert.equal(n, 1, 'l’artefact sain est tout de même supprimé');
      assert.deepEqual(removed, [clean]);
    } finally {
      t.mock.timers.reset();
    }
  });

  it('readdirSync en échec → 0 sans jamais lever', async () => {
    readdirThrows = true;
    const n = await removeLeftoverTempArtifacts(['electron-proof-'], { platform: 'win32' });
    assert.equal(n, 0);
    assert.deepEqual(removed, []);
  });

  it('tmp vide → 0', async () => {
    const n = await removeLeftoverTempArtifacts(['puppeteer_dev'], { platform: 'win32' });
    assert.equal(n, 0);
  });

  it('plateforme non-Windows (injectée) → no-op (0, aucun appel fs)', async () => {
    entries = ['electron-proof-ud-1'];
    const n = await removeLeftoverTempArtifacts(['electron-proof-'], { platform: 'linux' });
    assert.equal(n, 0);
    assert.deepEqual(removed, []);
  });
});