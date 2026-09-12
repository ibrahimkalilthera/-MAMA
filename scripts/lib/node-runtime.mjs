// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/node-runtime.mjs — resolve the project's pinned Node runtime.
//
// The problem this solves: `.nvmrc` + `node-version-file` pin the CI, and the
// first link of `npm run lint` refuses to run on another major — but that only
// HELPS a machine that already has the right node. On a machine whose default
// node is another major and which has no version manager installed, every hook
// and every gate simply refused, with "install nvm" as the only remedy. The
// project should provision what it pins.
//
// Resolution order (first hit wins, cheapest first):
//   1. `current`  — the running node already matches the pin (CI, or a dev who
//                   is on 22): nothing to do, nothing to download.
//   2. `cache`    — an absolute path recorded by a previous resolution, still
//                   present on disk. Survives across runs; a deleted file just
//                   moves us to the next provider.
//   3. `npm`      — the official `node@<major>` distribution fetched through
//                   npm (the package is published by the Node release team and
//                   ships exactly the official binary). No version manager, no
//                   admin rights, no system-wide install; npm is already a hard
//                   requirement of this project, so nothing new is introduced.
//                   Its npm-cli.js is NOT bundled, which is fine: the launcher
//                   runs the host's npm-cli.js (pure JS) on the pinned runtime.
//
// Resolution is a pure function of injected providers, so the whole order,
// including the failure path, is unit-tested without downloading anything.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { resolveNpmCliJs } from './npm-cli.mjs';

/** First integer in a version string (`v22.23.2`, `22`, `>=22 <23`), or null. */
export function majorOf(value) {
  const m = String(value ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/** True when a node version already runs the pinned major. */
export const runtimeMatches = (nodeVersion, pinned) => {
  const a = majorOf(nodeVersion);
  const b = majorOf(pinned);
  return a !== null && a === b;
};

/** The pinned major, read from `.nvmrc` (the single source of truth). */
export function pinnedMajor(root) {
  return readFileSync(join(root, '.nvmrc'), 'utf8');
}

/** Where a resolved runtime path is remembered (inside the ignored cache dir). */
export const cacheFileFor = (root) => join(root, 'node_modules', '.cache', 'mama-node-runtime.json');

/** A previously resolved path, or null when absent/unusable. */
export function readCachedExecPath(cacheFile, major) {
  try {
    const data = JSON.parse(readFileSync(cacheFile, 'utf8'));
    if (majorOf(data?.major) !== majorOf(major)) return null;
    if (typeof data.execPath !== 'string' || !existsSync(data.execPath)) return null;
    return data.execPath;
  } catch {
    return null;
  }
}

/** Remember a resolved path (best-effort: an unwritable cache is not an error). */
export function writeCachedExecPath(cacheFile, execPath, major) {
  try {
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify({ major: String(major), execPath }, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * The official `node@<major>` binary, fetched through npm. `npmExecPath` is the
 * node that runs npm (the current one — it needs no particular major).
 * @returns {string | null} absolute path of the resolved node, or null.
 */
export function fetchViaNpm(major, npmExecPath) {
  try {
    const npmCliJs = resolveNpmCliJs(npmExecPath);
    const r = spawnSync(
      npmExecPath,
      [npmCliJs, 'exec', '--yes', '--', `node@${major}`, '-p', 'process.execPath'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const execPath = (r.stdout || '').trim().split(/\r?\n/).pop();
    return r.status === 0 && execPath && existsSync(execPath) ? execPath : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the runtime the project pinned, in provider order.
 * @returns {{ execPath: string, source: 'current'|'cache'|'npm' }}
 * @throws when no provider can supply the pinned major — with the remedy, which
 *         never involves installing a version manager by hand.
 */
export function resolveNodeRuntime(options) {
  const {
    currentExecPath,
    currentVersion,
    pinned,
    cacheFile,
    fetchNpm = (major) => fetchViaNpm(major, currentExecPath),
  } = options;

  if (runtimeMatches(currentVersion, pinned)) {
    return { execPath: currentExecPath, source: 'current' };
  }

  const cached = readCachedExecPath(cacheFile, pinned);
  if (cached) return { execPath: cached, source: 'cache' };

  const fetched = fetchNpm(majorOf(pinned));
  if (fetched) {
    writeCachedExecPath(cacheFile, fetched, majorOf(pinned));
    return { execPath: fetched, source: 'npm' };
  }

  const error = new Error(
    `Node ${majorOf(pinned)} (voir .nvmrc) est introuvable et n'a pas pu être provisionné ` +
      `(hors ligne ?). Ici : Node ${currentVersion}.\n` +
      `   Remède : npm run setup:node   (aucun gestionnaire de version à installer)\n` +
      `   Diagnostic ponctuel sous l'autre majeur : npm run setup:node -- --check`,
  );
  error.code = 'EPINNEDRUNTIME';
  throw error;
}
