#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/install-git-shim.mjs - install/uninstall the native git.cmd shim.
//
// Copies scripts/git-shim.cmd to %LOCALAPPDATA%\MamaTheraGitShim\git.cmd and
// adds that directory to the USER PATH (HKCU\Environment, via PowerShell —
// no setx 1024-char limit), so every `git commit` / `git push` / `git pull` /
// `git rebase` from cmd.exe, PowerShell or a native launcher routes through
// scripts/git-retry.mjs (retry + --sweep against the msys fork panic). Node-based tools that spawn("git")
// without a shell skip .cmd files and keep using the real git.exe — verified
// empirically, no regression. Git Bash resolves git.exe directly and ignores
// the shim (keep using `node scripts/git-retry.mjs ...` there).
//
// The PATH entry is prepended to the USER PATH and only takes effect in NEW
// terminal sessions; run manually (NOT from the husky prepare script, which
// runs on every npm install incl. CI):
//   node scripts/install-git-shim.mjs            (install)
//   node scripts/install-git-shim.mjs --uninstall
// Set GIT_SHIM_BIN_DIR to install elsewhere (tests).
//
// HONEST PRECONDITION, checked by the self-test instead of assumed: Windows
// composes a process PATH as [MACHINE entries, then USER entries], so a shim on
// the *user* PATH cannot precede a git.exe installed machine-wide (the usual
// `C:\Program Files\Git\cmd`). Installed that way the shim is simply never
// executed — which `git --version` cannot tell you, since it answers the same
// either way. The installer therefore reports the precedence verdict and exits
// 1 when the shim is shadowed; making it win needs its directory at the head of
// the MACHINE PATH (admin), or a per-terminal prefix.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_BIN_DIR = join(
  process.env.LOCALAPPDATA || join(process.env.USERPROFILE || '.', 'AppData', 'Local'),
  'MamaTheraGitShim',
);

// ── PATH list helpers (pure, unit-tested) ────────────────────────────────────
export function splitPath(value = '') {
  return value.split(';').map((p) => p.trim()).filter(Boolean);
}

export function joinPath(parts) {
  return parts.join(';');
}

const norm = (p) => p.toLowerCase().replace(/[\\/]+$/, '');

/**
 * PREPEND (never append). The shim only exists to be found before the real
 * git, so it has to sit at the front of the list it can control. Appending
 * would still lose the *user-level* race it can win — and the entry is useless
 * anywhere but first.
 */
export function addPathEntry(parts, entry) {
  return parts.some((p) => norm(p) === norm(entry)) ? parts : [entry, ...parts];
}

export function removePathEntry(parts, entry) {
  return parts.filter((p) => norm(p) !== norm(entry));
}

// cmd.exe resolves a bare `git` by walking PATH directories in order and trying
// PATHEXT extensions inside each one: .COM, .EXE, .BAT, .CMD. Two consequences
// that decide whether the shim can ever run, and that a self-test must check
// rather than assume:
//   1. an earlier DIRECTORY wins, whatever the extension;
//   2. inside the SAME directory, git.exe beats git.cmd.
const GIT_LAUNCHERS = ['git.com', 'git.exe', 'git.bat'];

function dirProvidesGit(dir) {
  try {
    return GIT_LAUNCHERS.some((f) => existsSync(join(dir, f)));
  } catch {
    return false;
  }
}

/**
 * Can `git` actually reach the shim? Windows composes a process PATH as the
 * MACHINE entries followed by the USER entries, so an entry added to the user
 * PATH can never override a git.exe living in a machine directory — which is
 * the normal case (`C:\Program Files\Git\cmd`). This walks the composed PATH
 * in order and reports the first directory that would answer `git` before the
 * shim does.
 *
 * Pure (the filesystem probe is injected) so the verdict is tested without
 * touching the machine PATH.
 *
 * @param {{ machinePath?: string, userPath?: string, binDir: string,
 *   providesGit?: (dir: string) => boolean }} options
 * @returns {{ composedPath: string, shimIndex: number, installed: boolean,
 *   shadowedBy: string|null }}
 */
export function shimPrecedence({
  machinePath = '',
  userPath = '',
  binDir,
  providesGit = dirProvidesGit,
}) {
  const composedPath = joinPath([...splitPath(machinePath), ...splitPath(userPath)]);
  const parts = splitPath(composedPath);
  const shimIndex = parts.findIndex((p) => norm(p) === norm(binDir));
  if (shimIndex < 0) return { composedPath, shimIndex, installed: false, shadowedBy: null };
  for (let i = 0; i < shimIndex; i++) {
    if (providesGit(parts[i])) {
      return { composedPath, shimIndex, installed: true, shadowedBy: parts[i] };
    }
  }
  return { composedPath, shimIndex, installed: true, shadowedBy: null };
}

// ── User PATH access (PowerShell = registry-backed, no setx length limit) ────
// Note: everything after `-Command` is parsed as part of the script, so the
// new value is passed through an env var instead of a command-line argument.
const PS_GET = '[Environment]::GetEnvironmentVariable("Path","User")';
const PS_GET_MACHINE = '[Environment]::GetEnvironmentVariable("Path","Machine")';
const PS_SET = '[Environment]::SetEnvironmentVariable("Path",$env:GITSHIM_PATH,"User")';

export function readUserPath() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', PS_GET], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

export function readMachinePath() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', PS_GET_MACHINE], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? (r.stdout || '').trim() : '';
}

function writeUserPath(value) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', PS_SET], {
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, GITSHIM_PATH: value },
  });
  if (r.status !== 0) throw new Error(`écriture PATH utilisateur a échoué : ${(r.stderr || '').trim()}`);
}

// ── Install / uninstall ───────────────────────────────────────────────────────
/**
 * Install the shim. When `userPath` is injected the caller manages the PATH
 * write (tests); otherwise the real USER PATH is read and updated.
 * @param {{ binDir?: string, userPath?: string, log?: (...data: unknown[]) => void }} options
 */
export function installGitShim({
  binDir = DEFAULT_BIN_DIR,
  userPath,
  log = console.log,
} = {}) {
  const shimPath = join(binDir, 'git.cmd');
  mkdirSync(binDir, { recursive: true });
  copyFileSync(join(SCRIPT_DIR, 'git-shim.cmd'), shimPath);

  const hadPath = userPath !== undefined;
  const current = hadPath ? userPath : readUserPath();
  const next = joinPath(addPathEntry(splitPath(current), binDir));
  if (!hadPath && next !== current) writeUserPath(next);

  log(`✅ shim natif installé : ${shimPath}`);
  log(next === current ? 'ℹ️  déjà présent sur le PATH utilisateur (position inchangée).' : '✅ ajouté EN TÊTE du PATH utilisateur (nouveaux terminaux uniquement).');
  return { binDir, shimPath, pathChanged: next !== current };
}

/**
 * Self-test that can actually fail.
 *
 * `git --version` proves nothing: it answers identically whether the shim ran
 * or the real git.exe was found first — that is exactly the green this repo
 * keeps learning not to trust. Two separate questions, two separate probes:
 *
 *   1. CONTENT — does the shim route at all? Run a routed command in a repo
 *      that owns scripts/git-retry.mjs and look for the wrapper's marker.
 *   2. ENVIRONMENT — is the shim reachable? Compare its position in the
 *      composed (machine then user) PATH with the first directory that
 *      provides a `git` launcher.
 *
 * @param {{ binDir: string, machinePath?: string, userPath?: string,
 *   cwd?: string, providesGit?: (dir: string) => boolean }} options
 */
export function selfTestShim({
  binDir,
  machinePath = '',
  userPath = '',
  cwd = process.cwd(),
  providesGit,
} = /** @type {any} */ ({})) {
  const precedence = shimPrecedence({ machinePath, userPath, binDir, providesGit });
  // Routing can only be proven from a repo that carries the wrapper; elsewhere
  // the shim legitimately forwards and the probe would prove nothing.
  const probeable = existsSync(join(cwd, 'scripts', 'git-retry.mjs'));
  let routes = null;
  if (probeable) {
    const r = spawnSync('cmd', ['/c', 'git commit --dry-run'], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, PATH: `${binDir};${process.env.PATH || ''}` },
      timeout: 120000,
    });
    routes = /tentative \d+\/\d+/.test((r.stdout || '') + (r.stderr || ''));
  }
  return { precedence, routes, probeable };
}

/**
 * Remove the shim and its PATH entry. Same injection rules as installGitShim.
 * @param {{ binDir?: string, userPath?: string, log?: (...data: unknown[]) => void }} options
 */
export function uninstallGitShim({
  binDir = DEFAULT_BIN_DIR,
  userPath,
  log = console.log,
} = {}) {
  const hadPath = userPath !== undefined;
  const current = hadPath ? userPath : readUserPath();
  const next = joinPath(removePathEntry(splitPath(current), binDir));
  if (!hadPath && next !== current) writeUserPath(next);

  const shimPath = join(binDir, 'git.cmd');
  if (existsSync(shimPath)) rmSync(shimPath);
  if (existsSync(binDir)) {
    try { rmSync(binDir, { recursive: true }); } catch { /* keep */ }
  }
  log(next === current ? 'ℹ️  le répertoire n’était pas sur le PATH.' : '✅ répertoire retiré du PATH utilisateur.');
  return { binDir, pathChanged: next !== current };
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const uninstall = process.argv.includes('--uninstall');
  const binDir = process.env.GIT_SHIM_BIN_DIR || DEFAULT_BIN_DIR;
  const result = uninstall
    ? uninstallGitShim({ binDir })
    : installGitShim({ binDir });
  console.log(uninstall ? 'shim git désinstallé.' : 'shim git installé.');

  if (uninstall) process.exit(0);

  const { precedence, routes, probeable } = selfTestShim({
    binDir,
    machinePath: readMachinePath(),
    userPath: readUserPath(),
  });

  if (routes === true) {
    console.log('✅ auto-test (contenu) : le shim route réellement (git commit --dry-run → wrapper engagé).');
  } else if (routes === false) {
    console.log('❌ auto-test (contenu) : le shim a été exécuté mais n’a PAS routé — vérifier scripts/git-retry.mjs.');
  } else {
    console.log('ℹ️  auto-test (contenu) non concluant : lancer l’installateur depuis la racine du dépôt.');
  }

  // The environment half is the one that used to be missing: a shim that is
  // shadowed by a git.exe earlier in the composed PATH is inert, and
  // `git --version` says nothing about it.
  if (precedence.shadowedBy) {
    console.log(`❌ auto-test (environnement) : shim INACTIF — \`git\` se résout d’abord sur ${precedence.shadowedBy}`);
    console.log('   Windows compose le PATH en [machine puis utilisateur] : une entrée utilisateur ne peut pas');
    console.log('   précéder un git.exe du PATH machine. Remèdes :');
    console.log('     1. placer le dossier du shim EN TÊTE du PATH machine (droits admin) ;');
    console.log(`     2. pour un terminal donné : set PATH=${binDir};%PATH%`);
    console.log('     3. à la frappe, sans shim : npm run git:retry -- <commande git>');
    process.exit(1);
  }

  console.log(
    routes === false
      ? '❌ shim installé et atteint, mais le routage a échoué (voir ci-dessus).'
      : '✅ shim actif : `git` est résolu sur le shim, aucun git.exe ne le précède.',
  );
  console.log(`   (active dans les nouveaux terminaux ; annulable via node scripts/install-git-shim.mjs --uninstall)`);
  process.exit(routes === false ? 1 : 0);
}