#!/usr/bin/env node
/**
 * with-pinned-node.mjs — run a command under the Node runtime this project pins.
 *
 * Usage:
 *   node scripts/with-pinned-node.mjs <script.mjs> [args…]      # node <script>
 *   node scripts/with-pinned-node.mjs --node <script.mjs> …     # same, explicit
 *   node scripts/with-pinned-node.mjs --npm <script-name> …     # npm run <script>
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
 * entry point is enough for it. The npm chain is the one exception (`npm run`
 * resolves `eslint`/`tsc` through PATH), which is why a shim directory is
 * written and prepended when — and only when — the current node is not the pin;
 * see scripts/lib/node-path-shim.mjs.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join, resolve as resolvePath } from 'node:path';
import { resolveNpmCliJs } from './lib/npm-cli.mjs';
import { writePathShim } from './lib/node-path-shim.mjs';
import {
  cacheFileFor,
  majorOf,
  pinnedMajor,
  resolveNodeRuntime,
  runtimeMatches,
} from './lib/node-runtime.mjs';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const mode = argv[0] === '--npm' ? 'npm' : 'node';
const rest = mode === 'npm' ? argv.slice(1) : argv[0] === '--node' ? argv.slice(1) : argv;

if (rest.length === 0) {
  console.error('Usage : node scripts/with-pinned-node.mjs [--npm <script> | --node] <cible> [args…]');
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

const [command, args] =
  mode === 'npm'
    ? [runtime.execPath, [npmCliJs, 'run', rest[0], ...rest.slice(1)]]
    : [runtime.execPath, [join(root, rest[0]), ...rest.slice(1)]];

// Fast path (already on the pin, e.g. CI): no shim, no rewrite, no PATH change.
// MAMA_NPM_CLI_JS is always exported: children then resolve npm exactly, instead
// of searching the PATH — where our own shim would be found first and misread.
const env = { ...process.env, MAMA_PINNED_NODE: '1', MAMA_NPM_CLI_JS: npmCliJs };
if (runtime.source !== 'current') {
  env.PATH =
    writePathShim({ root, execPath: runtime.execPath, npmEntry: npmCliJs }) +
    delimiter +
    (process.env.PATH ?? '');
}

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
