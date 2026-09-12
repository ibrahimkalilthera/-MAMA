#!/usr/bin/env node
/**
 * with-pinned-node.mjs — run a command under the Node runtime this project pins.
 *
 * Usage:
 *   node scripts/with-pinned-node.mjs <script.mjs> [args…]      # node <script>
 *   node scripts/with-pinned-node.mjs --node <script.mjs> …     # same, explicit
 *   node scripts/with-pinned-node.mjs --npm <script-name> …     # npm run <script>
 *   node scripts/with-pinned-node.mjs --bin <command> [args…]   # a package's own bin
 *
 * `--bin` is what the daily commands use (`dev`, `build`, `preview`): they run
 * `vite`, which is a package BIN and not a script, so there is no npm script to
 * hand over — the entry is read from vite's own `bin` declaration and run by the
 * pinned runtime (./lib/chain-links.mjs). Without this mode those commands were
 * the last ones still resolving `vite` through PATH, i.e. the last ones able to
 * run on whatever node the shell happened to have.
 *
 * Why: `.nvmrc` pins the runtime and the quality chain refuses to run on another
 * major — a correct guard, but one that used to leave a machine without a
 * version manager with nothing but "install nvm". This launcher closes the gap:
 * it resolves the pinned runtime (provisioning the official node@<major> through
 * npm if needed, see scripts/lib/node-runtime.mjs) and re-executes the command
 * with it.
 *
 * When the current node already matches the pin — CI, or any machine on 22 —
 * resolution returns immediately and the command runs unchanged: no download, no
 * cache, no extra process beyond this one.
 *
 * Everything below an entry point inherits the pinned runtime, because the
 * quality chain spawns its steps through `process.execPath` (see
 * scripts/quality-chain.mjs) rather than through a PATH lookup — so pinning the
 * entry point is enough for it. The daily commands (`dev`, `build`, `preview`)
 * are pinned the same way, through `--bin`: they run vite's own entry under the
 * pinned runtime instead of letting a shell resolve `vite` from PATH.
 * The npm chain is the one remaining exception: `npm run`
 * resolves `node`, `eslint` and `tsc` through PATH, and the shims npm generates
 * in `node_modules/.bin` call `node`. That directory is therefore where the pin
 * is written — it is the one npm already puts FIRST for every script — instead
 * of a private directory prepended to the environment; see
 * scripts/lib/bin-shims.mjs. Nothing here rewrites PATH any more.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { resolveNpmCliJs } from './lib/npm-cli.mjs';
import { resolveToolEntry } from './lib/chain-links.mjs';
import { removeLegacyShimDir, writeBinShims } from './lib/bin-shims.mjs';
import {
  cacheFileFor,
  majorOf,
  pinnedMajor,
  resolveNodeRuntime,
  runtimeMatches,
} from './lib/node-runtime.mjs';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
// `--npm` runs a package.json script, `--bin` runs an installed package's own
// entry point (how a CLI like vite is reached without a shell), and the default
// form runs a script file through the pinned node.
const MODES = new Set(['--npm', '--bin', '--node']);
const mode = argv[0] === '--npm' ? 'npm' : argv[0] === '--bin' ? 'bin' : 'node';
const rest = MODES.has(argv[0]) ? argv.slice(1) : argv;

if (rest.length === 0) {
  console.error(
    'Usage : node scripts/with-pinned-node.mjs [--npm <script> | --bin <commande> | --node] <cible> [args…]',
  );
  process.exit(2);
}

const pinned = pinnedMajor(root);

// Recursion guard: if a previous launcher already handed us the pinned runtime
// and we still do not match, re-entering would loop forever. Fail loudly with
// the diagnosis instead.
if (process.env.MAMA_PINNED_NODE === '1' && !runtimeMatches(process.versions.node, pinned)) {
  console.error(
    `❌ Le lanceur a été réexécuté (MAMA_PINNED_NODE=1) mais Node ${process.versions.node} ` +
      `n'est toujours pas le majeur ${majorOf(pinned)} attendu — arrêt plutôt que boucle.`,
  );
  process.exit(1);
}

let runtime;
try {
  runtime = resolveNodeRuntime({
    currentExecPath: process.execPath,
    currentVersion: process.versions.node,
    pinned,
    cacheFile: cacheFileFor(root),
  });
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

if (runtime.source !== 'current') {
  console.log(
    `🔧 Node ${majorOf(pinned)} (épinglé par .nvmrc) — runtime ${runtime.source === 'npm' ? 'provisionné via npm' : 'en cache'} : ${runtime.execPath}`,
  );
  console.log(`   (le Node courant est ${process.versions.node} ; aucun gestionnaire de version requis)`);
}

const npmCliJs = resolveNpmCliJs(runtime.execPath);

/**
 * The JavaScript entry a package installs for `tool`, read from its own `bin`
 * declaration — the same one npm's `.bin` wrapper is generated from. A command
 * with no installed entry is an ERROR here, never a PATH lookup: that fallback
 * would hand `dev` back to whatever node the shell has, which is the whole
 * failure this launcher exists to prevent.
 */
function binEntry(tool) {
  const found = resolveToolEntry({ root, tool });
  if (!found.entry) {
    console.error(
      `❌ aucune entrée installée pour « ${tool} » (chemins essayés : ${found.tried.join(', ')}). ` +
        'Installez les dépendances, ou lancez la commande par npm.',
    );
    process.exit(1);
  }
  return found.entry;
}

const [command, args] = [
  runtime.execPath,
  mode === 'npm'
    ? [npmCliJs, 'run', rest[0], ...rest.slice(1)]
    : mode === 'bin'
      ? [binEntry(rest[0]), ...rest.slice(1)]
      : [join(root, rest[0]), ...rest.slice(1)],
];

// The pin is written where npm already looks (`node_modules/.bin`), so the
// environment is left ALONE: no PATH edit, nothing prepended. Written on every
// pass, not only when the runtime changes — an entry left by a previous major
// would otherwise survive a `.nvmrc` bump and win for every npm script. It is a
// cheap no-op when the content already matches.
// MAMA_NPM_CLI_JS is still exported: children then resolve npm by exact path
// instead of searching a PATH where our own npm shim now sits first.
writeBinShims({ root, execPath: runtime.execPath, npmEntry: npmCliJs });
removeLegacyShimDir({ root });

const env = { ...process.env, MAMA_PINNED_NODE: '1', MAMA_NPM_CLI_JS: npmCliJs };

const child = spawn(command, args, {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
  env,
});

// Forward the usual stops: a gate interrupted from the keyboard must stop the
// real work too, and the exit code must be the child's, never a swallowed 0.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  });
}

child.on('error', (error) => {
  console.error(`❌ Lancement impossible (${command}) : ${error.message}`);
  process.exit(1);
});

child.on('close', (code, signal) => {
  if (signal) {
    console.error(`❌ Interrompu par ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
