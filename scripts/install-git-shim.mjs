#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/install-git-shim.mjs - install/uninstall the native git.cmd shim.
//
// Copies scripts/git-shim.cmd to %LOCALAPPDATA%\MamaTheraGitShim\git.cmd and
// adds that directory to the USER PATH (HKCU\Environment, via PowerShell —
// no setx 1024-char limit), so every `git commit` / `git push` from cmd.exe,
// PowerShell or a native launcher routes through scripts/git-retry.mjs (retry
// + --sweep against the msys fork panic). Node-based tools that spawn("git")
// without a shell skip .cmd files and keep using the real git.exe — verified
// empirically, no regression. Git Bash resolves git.exe directly and ignores
// the shim (keep using `node scripts/git-retry.mjs ...` there).
//
// The PATH change is machine-level and only takes effect in NEW terminal
// sessions; run manually (NOT from the husky prepare script, which runs on
// every npm install incl. CI):
//   node scripts/install-git-shim.mjs            (install)
//   node scripts/install-git-shim.mjs --uninstall
// Set GIT_SHIM_BIN_DIR to install elsewhere (tests).
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

export function addPathEntry(parts, entry) {
  return parts.some((p) => norm(p) === norm(entry)) ? parts : [...parts, entry];
}

export function removePathEntry(parts, entry) {
  return parts.filter((p) => norm(p) !== norm(entry));
}

// ── User PATH access (PowerShell = registry-backed, no setx length limit) ────
// Note: everything after `-Command` is parsed as part of the script, so the
// new value is passed through an env var instead of a command-line argument.
const PS_GET = '[Environment]::GetEnvironmentVariable("Path","User")';
const PS_SET = '[Environment]::SetEnvironmentVariable("Path",$env:GITSHIM_PATH,"User")';

export function readUserPath() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', PS_GET], { encoding: 'utf8', windowsHide: true });
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
  log(next === current ? 'ℹ️  déjà présent sur le PATH utilisateur.' : '✅ ajouté au PATH utilisateur (nouveaux terminaux uniquement).');
  return { binDir, shimPath, pathChanged: next !== current };
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

  if (!uninstall) {
    // Self-test in a fresh cmd session: the shim must forward to the real git.
    const checkEnv = { ...process.env, PATH: `${binDir};${process.env.PATH || ''}` };
    const r = spawnSync('cmd', ['/c', 'git', '--version'], { encoding: 'utf8', env: checkEnv, windowsHide: true });
    const ok = r.status === 0 && /git version \d/.test(r.stdout || '');
    console.log(ok ? '✅ auto-test : git --version via le shim OK.' : `⚠️  auto-test : git via le shim a échoué (${r.status}).`);
    console.log(`   (active dans les nouveaux terminaux ; annulable via node scripts/install-git-shim.mjs --uninstall)`);
  }
  process.exit(0);
}