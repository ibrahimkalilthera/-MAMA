// Suite E2E pour scripts/git-shim.cmd — le proxy natif git.cmd.
//
// Copie le shim dans un répertoire temp, le met en tête du PATH du processus
// enfant (uniquement pour ce child, aucune modification machine) et l'exécute
// via cmd.exe réel contre de vrais dépôts git. Prouve :
//   - les commandes non commit/push passent telles quelles au vrai git ;
//   - `commit` / `push` sont routés vers scripts/git-retry.mjs du dépôt courant
//     (le log « tentative » du wrapper apparaît) ;
//   - dans un dépôt SANS scripts/git-retry.mjs, tout est simplement forwardé ;
//   - le code de sortie réel est préservé.
// Plain-node suite (git + cmd réels, dépôts jetables).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SHIM_SRC = join(process.cwd(), 'scripts', 'git-shim.cmd');

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-shim-e2e-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'T'], { cwd: dir });
  // A staged change makes `commit --dry-run` exit 0 (otherwise it exits 1).
  writeFileSync(join(dir, 'f.txt'), 'data');
  spawnSync('git', ['add', 'f.txt'], { cwd: dir });
  return dir;
}

function runShim(args: string[], cwd: string, shimDir: string) {
  return spawnSync('cmd', ['/c', join(shimDir, 'git.cmd'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shimDir};${process.env.PATH || ''}` },
    windowsHide: true,
  });
}

describe('git-shim.cmd (E2E cmd.exe réel)', () => {
  it('forwarde les commandes non commit/push telles quelles (pas de wrapper)', () => {
    const repo = makeRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      const r = runShim(['rev-parse', '--git-dir'], repo, shimDir);
      assert.equal(r.status, 0, r.stderr);
      assert.equal((r.stdout || '').trim(), '.git');
      assert.ok(!(r.stdout || '').includes('tentative'), 'pas de wrapper pour rev-parse');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('route `commit` via le wrapper git-retry du dépôt courant', () => {
    const repo = makeRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      // The repo must have scripts/git-retry.mjs for the shim to route through it.
      mkdirSync(join(repo, 'scripts'), { recursive: true });
      copyFileSync(join(process.cwd(), 'scripts', 'git-retry.mjs'), join(repo, 'scripts', 'git-retry.mjs'));
      const r = runShim(['commit', '--dry-run'], repo, shimDir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok((r.stdout || '').includes('git commit --dry-run'), 'log du wrapper présent');
      assert.ok((r.stdout || '').includes('tentative 1/3'), 'le retry engine est engagé');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('sans scripts/git-retry.mjs dans le dépôt → simple forward', () => {
    const repo = makeRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      const r = runShim(['commit', '--dry-run'], repo, shimDir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(!(r.stdout || '').includes('tentative'), 'aucun wrapper pour un dépôt étranger');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('préserve le code de sortie d’un échec réel', () => {
    const repo = makeRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      const r = runShim(['log', '--definitely-not-an-option'], repo, shimDir);
      assert.notEqual(r.status, 0, 'git a échoué et le shim a propagé le code');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });
});