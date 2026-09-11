// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/npm-cli.mjs — locate npm's JS entry point for a given node.
//
// Why this exists: on Windows, spawning `npm.cmd` requires a shell, and a shell
// is exactly what this machine's msys fork table cannot survive (see the
// fork-panic history in DEVELOPMENT_HISTORY.md). Spawning `node npm-cli.js`
// instead is shell-free — and it also lets us run npm under a node that is NOT
// the one that started us, which is how the project pins its runtime.
//
// `npmNode` is the node that should RUN npm (the pinned runtime). npm normally
// sits next to the node executable in a standard install; when it does not
// (e.g. a node binary that ships alone), fall back to the npm on PATH — its
// npm-cli.js is pure JavaScript and runs fine on the pinned runtime.
// ─────────────────────────────────────────────────────────────────────────────
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * @param {string} npmNode absolute path of the node that will run npm
 * @returns {string} absolute path of npm-cli.js
 */
export function resolveNpmCliJs(npmNode) {
  // 1. The caller already resolved it — exact, and immune to a PATH shim of
  //    ours sitting first (which is how the `where npm` fallback below ended up
  //    pointing at a directory that contains no npm at all).
  const declared = process.env.MAMA_NPM_CLI_JS;
  if (declared && existsSync(declared)) return declared;

  // 2/3. The two real layouts. Windows keeps npm in `node_modules/npm` next to
  //      node; Unix installs it in `<prefix>/lib/node_modules/npm`. Checking
  //      only the first is how CI went red: setup-node on ubuntu puts npm under
  //      lib/, so the resolver threw on the runner while passing at home.
  const layouts = ['node_modules', join('lib', 'node_modules')];
  const candidates = [];
  for (const base of [dirname(npmNode), dirname(dirname(npmNode))]) {
    for (const layout of layouts) candidates.push(join(base, layout, 'npm', 'bin', 'npm-cli.js'));
  }

  // 4. Last resort: the npm on PATH (its directory is the prefix, so both
  //    layouts are tried from there too).
  const which = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['npm'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .trim()
    .split(/\r?\n/)[0];
  for (const base of [dirname(which), dirname(dirname(which))]) {
    for (const layout of layouts) candidates.push(join(base, layout, 'npm', 'bin', 'npm-cli.js'));
  }

  for (const cli of candidates) if (existsSync(cli)) return cli;

  throw new Error(
    `npm-cli.js introuvable (node : ${npmNode}). ` +
      `Définissez MAMA_NPM_CLI_JS, ou installez npm à côté de node.`,
  );
}
