// Suite for scripts/install-git-shim.mjs — pure PATH helpers + install/uninstall
// with an INJECTED userPath (never touches the real machine PATH).
// Plain-node suite.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  installGitShim,
  uninstallGitShim,
  splitPath,
  joinPath,
  addPathEntry,
  removePathEntry,
  shimPrecedence,
} = await import('../scripts/install-git-shim.mjs');

const quiet = { log: () => {} };

describe('PATH helpers', () => {
  it('split/join font le roundtrip sans doublons', () => {
    const parts = splitPath('C:\\a;C:\\b');
    assert.deepEqual(parts, ['C:\\a', 'C:\\b']);
    assert.equal(joinPath(parts), 'C:\\a;C:\\b');
  });

  it('addPathEntry PRÉFIXE (jamais en queue) et ignore les doublons', () => {
    // Le shim n'existe que pour être trouvé AVANT le vrai git : une entrée
    // ajoutée en queue perd même la course qu'il peut gagner.
    const parts = ['C:\\Program Files\\Git'];
    assert.deepEqual(addPathEntry(parts, 'c:\\program files\\git\\'), parts, 'déjà présent → inchangé');
    assert.deepEqual(addPathEntry(parts, 'C:\\bin'), ['C:\\bin', 'C:\\Program Files\\Git']);
  });

  it('removePathEntry retire exactement l’entrée ciblée', () => {
    assert.deepEqual(removePathEntry(['C:\\bin', 'C:\\Program Files\\Git'], 'C:\\BIN\\'), ['C:\\Program Files\\Git']);
    assert.deepEqual(removePathEntry(['C:\\bin'], 'C:\\autre'), ['C:\\bin']);
  });
});

describe('shimPrecedence — le shim peut-il seulement être atteint ?', () => {
  const binDir = 'C:\\Shim';
  const noGit = () => false;

  it('signalé PARASITÉ quand un dossier antérieur fournit déjà un git', () => {
    // Composition Windows : PATH machine PUIS PATH utilisateur — donc un
    // git.exe machine (C:\\Program Files\\Git\\cmd) passe toujours avant une
    // entrée utilisateur, même préfixée.
    const r = shimPrecedence({
      machinePath: 'C:\\Windows;C:\\Program Files\\Git\\cmd',
      userPath: 'C:\\Shim;C:\\autre',
      binDir,
      providesGit: (d) => /Git/i.test(d),
    });
    assert.equal(r.installed, true);
    assert.equal(r.shadowedBy, 'C:\\Program Files\\Git\\cmd');
  });

  it('aucun parasite quand le shim est avant tout fournisseur de git', () => {
    const r = shimPrecedence({
      machinePath: 'C:\\Shim;C:\\Windows',
      userPath: 'C:\\Program Files\\Git\\cmd',
      binDir,
      providesGit: (d) => /Git/i.test(d),
    });
    assert.equal(r.shadowedBy, null);
    assert.equal(r.shimIndex, 0);
  });

  it('installed=false quand le dossier du shim n’est pas (encore) sur le PATH', () => {
    const r = shimPrecedence({ machinePath: 'C:\\Windows', userPath: 'C:\\autre', binDir, providesGit: noGit });
    assert.equal(r.installed, false);
    assert.equal(r.shimIndex, -1);
    assert.equal(r.shadowedBy, null);
  });
});

describe('installGitShim (PATH injecté, aucune écriture machine)', () => {
  it('copie git.cmd dans le binDir et ajoute l’entrée au PATH', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'git-shim-'));
    try {
      const r = installGitShim({ binDir, userPath: 'C:\\existing', ...quiet });
      assert.ok(existsSync(join(binDir, 'git.cmd')), 'shim copié');
      assert.equal(r.pathChanged, true);
      assert.ok(r.binDir);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('est idempotent : un second run ne change plus le PATH', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'git-shim-'));
    try {
      installGitShim({ binDir, userPath: 'C:\\existing;' + binDir, ...quiet });
      const r = installGitShim({ binDir, userPath: 'C:\\existing;' + binDir, ...quiet });
      assert.equal(r.pathChanged, false);
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  it('uninstall retire l’entrée et supprime le répertoire', () => {
    const binDir = mkdtempSync(join(tmpdir(), 'git-shim-'));
    try {
      installGitShim({ binDir, userPath: 'C:\\existing', ...quiet });
      const r = uninstallGitShim({ binDir, userPath: 'C:\\existing;' + binDir, ...quiet });
      assert.equal(r.pathChanged, true);
      assert.ok(!existsSync(binDir), 'répertoire supprimé');
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });
});