// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/npm-cli.mjs — locate npm's JS entry point for a given node, and
// say WHY that path won.
//
// Why this exists: on Windows, spawning `npm.cmd` requires a shell, and a shell
// is exactly what this machine's msys fork table cannot survive (see the
// fork-panic history in DEVELOPMENT_HISTORY.md). Spawning `node npm-cli.js`
// instead is shell-free — and it also lets us run npm under a node that is NOT
// the one that started us, which is how the project pins its runtime.
//
// `npmNode` is the node that should RUN npm (the pinned runtime). npm normally
// sits next to the node executable in a standard install; when it does not
// (e.g. a node binary that ships alone, like the official `node` npm package),
// fall back to the npm on PATH — its npm-cli.js is pure JavaScript and runs
// fine on the pinned runtime.
//
// The two layouts are CONTRACTS, not preferences: Windows installs npm in
// `<prefix>/node_modules/npm`, Unix installs (including the CI's setup-node) in
// `<prefix>/lib/node_modules/npm`. Searching only the first is how a green
// local run went red on ubuntu — so the search reports the layout it used, and
// `scripts/verify-node-layout.mjs` asserts it on a real runner of each platform
// (a fabricated tree can prove the candidate list; only a real machine can
// prove the machine).
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** npm's nested directory, per install layout, in probe order. */
export const NPM_NESTED_LAYOUTS = ['node_modules', join('lib', 'node_modules')];

/** `where npm` / `which npm`, every hit, or [] when npm is not on the PATH. */
function whichNpm(command) {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Is this hit one of OUR own wrappers? The project writes `node`, `npm` and
 * `npx` into `node_modules/.bin` (see ./bin-shims.mjs) — the directory npm puts
 * first for every script — so a PATH search can now land on a wrapper that
 * contains no npm at all. The directory is the tell: a real npm lives in an
 * install prefix (`lib/node_modules/npm`, `node_modules/npm`, a global bin dir),
 * never in a project's `.bin`.
 *
 * @param {string} hit
 * @returns {boolean}
 */
export function isProjectBinShim(hit) {
  return /[\\/]node_modules[\\/]\.bin[\\/]/.test(String(hit ?? ''));
}

/**
 * Explain the resolution: the path, where it came from, and how many candidates
 * were probed. `source` is the part a check can assert on:
 *   `declared` — MAMA_NPM_CLI_JS, an explicit override (wins, by design);
 *   `layout`   — found BESIDE node, in one of the two real layouts;
 *   `path`     — fell back to the npm on PATH (usable, but not the machine's
 *                own install — the fallback is what a check must not confuse
 *                with the real thing).
 *
 * Deps are injectable so both the search and its failure are testable without a
 * filesystem or a PATH.
 *
 * @param {string} npmNode absolute path of the node that will run npm
 * @param {{ exists?: (p: string) => boolean, declared?: string, which?: (c: string) => string[] | null }} [deps]
 * @returns {{ path: string | null, source: 'declared' | 'layout' | 'path' | null,
 *            layout: string | null, prefix: string | null, tried: string[] }}
 */
export function explainNpmCliJs(npmNode, deps = {}) {
  const {
    exists = existsSync,
    declared = process.env.MAMA_NPM_CLI_JS,
    which = whichNpm,
  } = deps;
  const tried = [];
  const probe = (prefix, layout, source) => {
    const candidate = join(prefix, layout, 'npm', 'bin', 'npm-cli.js');
    tried.push(candidate);
    return exists(candidate) ? { path: candidate, source, layout, prefix, tried } : null;
  };

  // 1. The caller already resolved it — exact, and immune to a PATH shim of
  //    ours sitting first (which is how the `where npm` fallback below ended up
  //    pointing at a directory that contains no npm at all).
  if (declared && exists(declared)) {
    return { path: declared, source: 'declared', layout: null, prefix: null, tried };
  }

  // 2. Beside node, in either real layout.
  for (const base of [dirname(npmNode), dirname(dirname(npmNode))]) {
    for (const layout of NPM_NESTED_LAYOUTS) {
      const hit = probe(base, layout, 'layout');
      if (hit) return hit;
    }
  }

  // 3. Last resort: the npm on PATH (its directory is the prefix, so both
  //    layouts are tried from there too) — skipping our own `.bin` wrappers,
  //    which are found first and lead nowhere.
  for (const onPath of (which('npm') ?? []).filter((hit) => !isProjectBinShim(hit))) {
    for (const base of [dirname(onPath), dirname(dirname(onPath))]) {
      for (const layout of NPM_NESTED_LAYOUTS) {
        const hit = probe(base, layout, 'path');
        if (hit) return hit;
      }
    }
  }

  return { path: null, source: null, layout: null, prefix: null, tried };
}

/**
 * @param {string} npmNode absolute path of the node that will run npm
 * @param {object} [deps] same seams as {@link explainNpmCliJs}
 * @returns {string} absolute path of npm-cli.js
 * @throws when neither node's install nor the PATH offers one — with the paths
 *         actually probed, because "introuvable" alone tells nobody what to fix.
 */
export function resolveNpmCliJs(npmNode, deps) {
  const found = explainNpmCliJs(npmNode, deps);
  if (found.path) return found.path;
  throw new Error(
    `npm-cli.js introuvable (node : ${npmNode}). ` +
      `Définissez MAMA_NPM_CLI_JS, ou installez npm à côté de node. ` +
      `Chemins essayés : ${found.tried.join(', ')}`,
  );
}
