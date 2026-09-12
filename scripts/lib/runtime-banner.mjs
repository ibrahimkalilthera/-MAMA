// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/runtime-banner.mjs — dire quel Node fait tourner le serveur de
// dev, et repérer l'autre majeur présent dans l'environnement.
//
// WHY AT STARTUP, AND WHY IT IS NOT DECORATION
// --------------------------------------------
// A runtime mismatch never fails where it starts: `vite` 24 serves a bundle
// built by a 24 that the CI will build with a 22, and the difference shows up
// later — in a lockfile install, a `node:` API that exists only in one of them,
// or a `dev` that works while `build` fails. The launcher (../with-pinned-node.mjs)
// already says something when it had to SWITCH runtime; it is silent when the
// major already matched, so a correctly pinned start and an accidentally
// correct one look identical. The banner closes that: one line naming the
// runtime, always, at the moment the server binds.
//
// The second half is the environment, not the process: a shell in this terminal
// resolves `node` through PATH, where a machine-wide install can sit — that is
// the node a `git commit`, another `npm install` or an editor task will use,
// and the banner names it instead of letting it be discovered by a red build.
// Commands the project owns do not depend on it (every entry goes through the
// launcher), which is exactly why it is a warning and not a stop.
//
// Nothing here is allowed to break a dev server: an unreadable `.nvmrc`, a
// `where` that fails, a node that does not answer — each degrades to a line
// saying so, or to silence, never to an exception.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { majorOf, pinnedMajor } from './node-runtime.mjs';

/** The project root — this file lives in `<root>/scripts/lib/`. */
export const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A path under a `node_modules` belongs to the project, never to the
 * environment: that is where the pin's entries live (`node_modules/.bin/node`)
 * and where the provisioned runtime is cached
 * (`…/npm-cache/_npx/…/node_modules/node/bin/node.exe`). Both are the project's
 * own runtime — warning that "another major is present" about them would be
 * warning about the pin itself.
 * @param {string} path
 * @returns {boolean}
 */
export const isProjectOwned = (path) =>
  String(path ?? '')
    .split(/[\\/]/)
    .includes('node_modules');

/**
 * The pinned major, or `null` when `.nvmrc` is unreadable. `null` is carried
 * all the way to the output as a line that says it — never replaced by a guess
 * (a banner that invents a major is worse than no banner).
 * @param {string} [root]
 * @returns {number|null}
 */
export function pinnedMajorOrNull(root = ROOT) {
  try {
    return majorOf(pinnedMajor(root));
  } catch {
    return null;
  }
}

/**
 * The banner, PURE: versions in, lines out.
 *
 * @param {{ pinned?: number|null, runVersion?: string, execPath?: string,
 *   others?: { path: string, version: string, major?: number }[] }} [input]
 * @returns {string[]}
 */
export function bannerLines({ pinned = null, runVersion = '', execPath = '', others = [] } = {}) {
  const run = majorOf(runVersion);
  const lines = [];

  if (pinned === null) {
    lines.push(
      `⚠️  dev : Node ${runVersion} — \`.nvmrc\` illisible, donc impossible de dire si c'est le majeur attendu.`,
    );
  } else if (run !== pinned) {
    lines.push(
      `⚠️  dev : ce serveur tourne sur Node ${runVersion} alors que \`.nvmrc\` épingle le majeur ${pinned}.`,
    );
    lines.push(
      '   Un écart de majeur ne casse pas au démarrage, il casse plus loin : lancez `npm run dev`, qui ' +
        'exécute vite sous le runtime épinglé (`scripts/with-pinned-node.mjs --bin vite`).',
    );
  } else {
    lines.push(
      `🟢 dev : Node ${runVersion} — majeur ${pinned} attendu (\`.nvmrc\`)${execPath ? ` · ${execPath}` : ''}`,
    );
  }

  for (const other of others) {
    lines.push(
      `⚠️  autre Node dans l'environnement : ${other.version} (${other.path}) — un shell de ce terminal peut ` +
        "l'utiliser ; les entrées du projet, non (elles passent par le lanceur épinglé).",
    );
  }
  return lines;
}

/**
 * The nodes of a search path that are NOT the project's and do NOT run the
 * pinned major — i.e. the ones worth naming.
 *
 * `runVersion` is injected: a suite must prove the filtering (project-owned
 * paths skipped, same major skipped, unreadable version skipped, cap honoured)
 * without spawning anything.
 *
 * @param {{ candidates?: string[], runVersion?: (path: string) => string,
 *   pinned?: number|null, limit?: number }} [options]
 * @returns {{ path: string, version: string, major: number }[]}
 */
export function otherNodes({
  candidates = [],
  runVersion = () => '',
  pinned = null,
  limit = 3,
} = {}) {
  const out = [];
  for (const path of candidates) {
    if (!path || isProjectOwned(path)) continue;
    const version = String(runVersion(path) ?? '').trim();
    const major = majorOf(version);
    if (major === null) continue; // no answer (or a .cmd a spawn cannot run): nothing to claim
    if (pinned !== null && major === pinned) continue; // the same major elsewhere is not news
    out.push({ path, version, major });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Every `node` a shell would find in PATH (`where` on Windows, `which -a`
 * elsewhere). Read-only, never throws: no answer is an empty list.
 * @param {{ platform?: string, spawn?: typeof spawnSync }} [options]
 * @returns {string[]}
 */
export function pathNodeCandidates({ platform = process.platform, spawn = spawnSync } = {}) {
  const [command, args] = platform === 'win32' ? ['where', ['node']] : ['which', ['-a', 'node']];
  try {
    const result = spawn(command, args, { encoding: 'utf8', windowsHide: true });
    return String(result?.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * The version an executable reports, or `''`. A `.cmd`/`.bat` shim outside a
 * `node_modules` cannot be spawned without a shell and simply answers nothing —
 * which reads as "not a runtime we can name", the honest outcome.
 * @param {string} execPath
 * @param {{ spawn?: typeof spawnSync }} [options]
 * @returns {string}
 */
export function versionOf(execPath, { spawn = spawnSync } = {}) {
  try {
    const result = spawn(execPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
    });
    return result?.status === 0 ? String(result.stdout).trim() : '';
  } catch {
    return '';
  }
}

/**
 * The Vite plugin: prints the banner when the dev server starts.
 *
 * It runs at `configureServer` — before the listener opens, so the runtime is on
 * screen above Vite's own `ready` block, which is where someone looks when a
 * dev server misbehaves. Nothing in it may throw: a banner that breaks `npm run
 * dev` would be worse than the mismatch it reports.
 *
 * @param {{ root?: string }} [options]
 */
export function devRuntimeBanner({ root = ROOT } = {}) {
  return {
    name: 'mama-dev-runtime-banner',
    configureServer(server) {
      try {
        const pinned = pinnedMajorOrNull(root);
        const others = otherNodes({
          candidates: pathNodeCandidates(),
          runVersion: (path) => versionOf(path),
          pinned,
        });
        const lines = bannerLines({
          pinned,
          runVersion: process.versions.node,
          execPath: process.execPath,
          others,
        });
        for (const line of lines) server?.config?.logger?.info?.(line);
      } catch (error) {
        server?.config?.logger?.warn?.(`⚠️  bandeau runtime indisponible : ${error?.message ?? error}`);
      }
    },
  };
}
