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
 * entry point is enough, and no PATH shim is needed (or wanted: a shim is what
 * silently broke earlier attempts at this).
 */
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, join, resolve as resolvePath } from 'node:path';
import { resolveNpmCliJs } from './lib/npm-cli.mjs';
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

/**
 * A repo-local PATH shim, written only when the pin actually needs one.
 *
 * Why it is unavoidable: the npm chain resolves `node`, `eslint` and `tsc`
 * through PATH (the .bin shims call `node`). Re-execing the launcher is not
 * enough for those — without this, `npm run lint` on another major would still
 * run the links on the wrong runtime. Proven the hard way: the version gate
 * caught exactly that (a green-looking chain on Node 24).
 *
 * It lives in the ignored cache dir, is rewritten only when the resolved
 * runtime changes, and is never needed on a machine already on the pinned
 * major (CI included) — there, the fast path skips it entirely.
 * @param {string} execPath pinned node
 * @returns {string} directory to prepend to PATH
 */
function writePathShim(execPath) {
  const dir = join(root, 'node_modules', '.cache', 'pinned-node-bin');
  mkdirSync(dir, { recursive: true });
  // Every shim is an ARGV PREFIX, not a single executable: npm and npx are .js
  // entry points and must be handed to the pinned node, never exec'd directly
  // (a bare `exec npm-cli.js` is what silently broke the audit step — the
  // offline branch then hung for its whole timeout instead of failing loudly).
  const argvFor = (/** @type {string} */ node, /** @type {string[]} */ extra) => [node, ...extra];
  const posix = (/** @type {string[]} */ argv) =>
    `#!/bin/sh\nexec ${argv.map((a) => JSON.stringify(a)).join(' ')} "$@"\n`;
  // CRLF matters for .cmd: cmd.exe misparses LF-only files badly enough that
  // the shim leaks back to the host runtime mid-chain.
  const windows = (/** @type {string[]} */ argv) =>
    `@echo off\r\n${argv.map((a) => `"${a}"`).join(' ')} %*\r\n`;
  const write = (/** @type {string} */ name, /** @type {string} */ body) => {
    const file = join(dir, name);
    if (existsSync(file) && readFileSync(file, 'utf8') === body) return;
    writeFileSync(file, body);
    if (!name.endsWith('.cmd')) chmodSync(file, 0o755);
  };
  const npxCliJs = join(dirname(npmCliJs), 'npx-cli.js');
  /** @type {Record<string, string[]>} */
  const targets = {
    node: argvFor(execPath, []),
    npm: argvFor(execPath, [npmCliJs]),
    npx: argvFor(execPath, [existsSync(npxCliJs) ? npxCliJs : npmCliJs]),
  };
  for (const [name, argv] of Object.entries(targets)) {
    write(name, posix(argv));
    write(`${name}.cmd`, windows(argv));
  }
  return dir;
}

const [command, args] =
  mode === 'npm'
    ? [runtime.execPath, [npmCliJs, 'run', rest[0], ...rest.slice(1)]]
    : [runtime.execPath, [join(root, rest[0]), ...rest.slice(1)]];

// Fast path (already on the pin, e.g. CI): no shim, no rewrite, no PATH change.
// MAMA_NPM_CLI_JS is always exported: children then resolve npm exactly, instead
// of searching the PATH — where our own shim would be found first and misread.
const env = { ...process.env, MAMA_PINNED_NODE: '1', MAMA_NPM_CLI_JS: npmCliJs };
if (runtime.source !== 'current') {
  env.PATH = writePathShim(runtime.execPath) + delimiter + (process.env.PATH ?? '');
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
