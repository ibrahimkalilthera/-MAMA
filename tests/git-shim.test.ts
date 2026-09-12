// Suite E2E pour scripts/git-shim.cmd — le proxy natif git.cmd.
//
// Copie le shim dans un répertoire temp, le met en tête du PATH du processus
// enfant (uniquement pour ce child, aucune modification machine) et l'exécute
// via cmd.exe réel contre de vrais dépôts git. Prouve :
//   - les commandes non routées passent telles quelles au vrai git ;
//   - `commit` / `push` / `pull` / `rebase` sont routés vers scripts/git-retry.mjs
//     du dépôt courant (le log « tentative » du wrapper apparaît), et un succès
//     comme un échec réel en ressortent avec le code de git, jamais retentés ;
//   - dans un dépôt SANS scripts/git-retry.mjs, tout est simplement forwardé ;
//   - le code de sortie réel est préservé.
// Plain-node suite (git + cmd réels, dépôts jetables).
//
// Windows-only BY NATURE: the shim IS a .cmd driven by cmd.exe, so the suite
// is skipped on Linux/CI runners instead of failing on a missing `cmd`. The
// wrapper itself (git-retry.mjs) keeps its own platform-injected suite,
// which runs everywhere.
//
// @platform-skip : le shim EST un .cmd — la suite exige un vrai cmd.exe, elle ne
// peut pas tourner sur un runner Linux. Déclaré ici pour que le gate de
// neutralisation (scripts/check-test-integrity.mjs) l'affiche dans son résumé à
// chaque run au lieu de laisser croire que ces tests ont tourné.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

// A repo wired to a real (local) remote with an upstream branch, so `git pull`
// and `git rebase` have something legitimate to do and exit 0 — the only way
// to prove routing WITHOUT also proving that git fails: the wrapper's own
// "tentative 1/3" line is what distinguishes a routed command from a forwarded
// one, and a zero exit proves success is still passed through untouched.
function makeClonedRepo(): { repo: string; origin: string } {
  const origin = mkdtempSync(join(tmpdir(), 'git-shim-origin-'));
  spawnSync('git', ['init', '--bare', '-q'], { cwd: origin });
  const repo = mkdtempSync(join(tmpdir(), 'git-shim-e2e-'));
  for (const args of [
    ['init', '-q'],
    ['config', 'user.email', 't@t'],
    ['config', 'user.name', 'T'],
  ]) {
    spawnSync('git', args, { cwd: repo });
  }
  writeFileSync(join(repo, 'f.txt'), 'data');
  spawnSync('git', ['add', 'f.txt'], { cwd: repo });
  spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  spawnSync('git', ['remote', 'add', 'origin', origin], { cwd: repo });
  spawnSync('git', ['push', '-q', '-u', 'origin', 'HEAD'], { cwd: repo });
  return { repo, origin };
}

/**
 * Copy the wrapper AND its local module graph into the fixture repo.
 *
 * A hand-written file list is what broke this suite the moment the wrapper
 * gained a dependency (`./lib/orphan-node.mjs`): the shim routed, the wrapper
 * died on module resolution, and the test looked like a routing bug. Copying
 * the graph makes the fixture follow the real imports.
 */
function copyWrapper(repo: string) {
  const scriptsDir = join(process.cwd(), 'scripts');
  const copied = new Set<string>();
  const copyOne = (rel: string) => {
    const normalised = rel.replace(/\\/g, '/');
    if (copied.has(normalised)) return;
    copied.add(normalised);
    const src = join(scriptsDir, normalised);
    const dest = join(repo, 'scripts', normalised);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(src, dest);
    const code = readFileSync(src, 'utf8');
    for (const match of code.matchAll(/from\s+'(\.[^']+)'/g)) {
      copyOne(join(dirname(normalised), match[1]).replace(/\\/g, '/'));
    }
  };
  copyOne('git-retry.mjs');
}

function runShim(args: string[], cwd: string, shimDir: string) {
  return spawnSync('cmd', ['/c', join(shimDir, 'git.cmd'), ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shimDir};${process.env.PATH || ''}` },
    windowsHide: true,
  });
}

describe('git-shim.cmd (E2E cmd.exe réel)', { skip: process.platform !== 'win32' }, () => {
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
      copyWrapper(repo);
      const r = runShim(['commit', '--dry-run'], repo, shimDir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok((r.stdout || '').includes('git commit --dry-run'), 'log du wrapper présent');
      assert.ok((r.stdout || '').includes('tentative 1/3'), 'le retry engine est engagé');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('route `pull` via le wrapper du dépôt courant et préserve le succès réel', () => {
    const { repo, origin } = makeClonedRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      copyWrapper(repo);
      const r = runShim(['pull'], repo, shimDir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok((r.stdout || '').includes('git pull'), 'label du wrapper présent');
      assert.ok((r.stdout || '').includes('tentative 1/3'), 'pull est routé, pas forwardé');
      assert.ok((r.stdout || '').includes('OK'), 'succès git transmis tel quel');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('route `rebase` via le wrapper du dépôt courant et préserve le succès réel', () => {
    const { repo, origin } = makeClonedRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      copyWrapper(repo);
      const r = runShim(['rebase'], repo, shimDir);
      assert.equal(r.status, 0, r.stderr);
      assert.ok((r.stdout || '').includes('git rebase'), 'label du wrapper présent');
      assert.ok((r.stdout || '').includes('tentative 1/3'), 'rebase est routé, pas forwardé');
    } finally {
      rmSync(repo, { recursive: true, force: true });
      rmSync(origin, { recursive: true, force: true });
      rmSync(shimDir, { recursive: true, force: true });
    }
  });

  it('un échec réel de `pull` n’est pas retenté et garde le code de git', () => {
    // Same repo, but without any remote: `git pull` fails for a real reason.
    // The wrapper must hand git's verdict back untouched — no retry (a retry
    // would hide a real configuration error behind a second identical failure)
    // and the same exit code as the real git.exe.
    const repo = makeRepo();
    const shimDir = mkdtempSync(join(tmpdir(), 'git-shim-bin-'));
    try {
      copyFileSync(SHIM_SRC, join(shimDir, 'git.cmd'));
      copyWrapper(repo);
      const direct = spawnSync('git', ['pull'], { cwd: repo, encoding: 'utf8', windowsHide: true });
      const r = runShim(['pull'], repo, shimDir);
      assert.notEqual(r.status, 0, 'git pull sans remote échoue');
      assert.equal(r.status, direct.status, 'code de sortie de git préservé');
      const out = r.stdout || '';
      assert.ok(out.includes('git pull'), 'le wrapper a bien pris la commande');
      assert.ok(!out.includes('retry dans'), 'échec réel → aucun retry');
      assert.ok(!out.includes('persistant'), 'échec réel → pas d’épuisement des tentatives');
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