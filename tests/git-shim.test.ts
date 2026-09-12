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

/**
 * Une commande de FIXTURE, qui DOIT réussir — et qui le dit quand ce n'est pas
 * le cas.
 *
 * Mesuré : dans un run complet, le `git push -u origin HEAD` de la fixture a
 * échoué une fois (épuisement transitoire des processus de la machine, la même
 * panique de fork que les wrappers du dépôt retentent), et l'échec est ressorti
 * trois lignes plus loin en « There is no tracking information for the current
 * branch » — c'est-à-dire en accusant le code testé. La même suite passe 7/7
 * seule. Une fixture qui avale sa propre panne fabrique un faux rouge, et un
 * faux rouge coûte plus cher qu'un rouge : on cherche au mauvais endroit.
 *
 * D'où trois tentatives (la panne est transitoire) puis un échec NOMMÉ : ce qui
 * a échoué, combien de fois, et ce que git a répondu.
 */
function setupStep(args: string[], cwd: string): void {
  let status: number | null = null;
  let detail = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
    status = r.status;
    detail = r.stderr || r.error?.message || '';
    if (r.status === 0) return;
  }
  assert.fail(
    `fixture : \`git ${args.join(' ')}\` a échoué après 3 tentatives (code ${status}) — ${detail.trim()}`,
  );
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'git-shim-e2e-'));
  setupStep(['init', '-q'], dir);
  setupStep(['config', 'user.email', 't@t'], dir);
  setupStep(['config', 'user.name', 'T'], dir);
  // A staged change makes `commit --dry-run` exit 0 (otherwise it exits 1).
  writeFileSync(join(dir, 'f.txt'), 'data');
  setupStep(['add', 'f.txt'], dir);
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
    setupStep(args, repo);
  }
  writeFileSync(join(repo, 'f.txt'), 'data');
  setupStep(['add', 'f.txt'], repo);
  setupStep(['commit', '-q', '-m', 'init'], repo);
  setupStep(['remote', 'add', 'origin', origin], repo);
  // Le nom de branche est RÉSOLU puis nommé : pousser `HEAD` peut ne laisser
  // aucun upstream derrière soi (git ne saurait alors pas quel nom de branche
  // distante inscrire), et la fixture doit garantir que `git pull` a quelque
  // chose à faire — c'est tout l'intérêt du cas.
  const branch = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  setupStep(['push', '-q', '--set-upstream', 'origin', branch], repo);
  setupStep(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repo);
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