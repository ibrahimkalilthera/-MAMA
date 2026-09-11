// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/bin-shims.mjs — make `node` mean the pin, where npm already looks.
//
// WHY HERE, AND NOT IN PATH
// -------------------------
// The launcher used to write node/npm/npx wrappers into a private directory and
// PREPEND it to PATH. It worked, but it rewrote the environment of every child,
// and it poisoned `which npm`: the fallback in ./npm-cli.mjs found our own
// wrapper and derived a path that contains no npm (a real bug, paid for once).
//
// npm already provides the hook: for every script it runs it puts
// `<project>/node_modules/.bin` FIRST on PATH — that is how `eslint` and `tsc`
// resolve — and the shims npm generates there prefer a local node when one
// exists:
//     .cmd  : IF EXIST "%dp0%\node.exe" ( … ) ELSE ( SET "_prog=node" … )
//     posix : if [ -x "$basedir/node" ]; then exec "$basedir/node" … ; else exec node … ; fi
// So writing `node` (plus npm and npx) INTO that directory makes the pin
// structural: nothing has to be rewritten in the environment, because the
// directory npm insists on putting first is the one carrying the pin. The
// entries we do not own (`eslint`, `tsc`, …) are npm's and are never touched.
//
// Two details are contracts, not choices — both were paid for by a real bug:
//
//   1. Every shim is an ARGV PREFIX (`node <cli.js>`), never a bare executable.
//      Handing npm-cli.js to the OS made the audit step take its offline branch
//      and hang until its timeout instead of failing loudly.
//   2. `.cmd` files are written with CRLF. cmd.exe misparses LF-only .cmd badly
//      enough that the shim leaks back to the host runtime mid-chain.
//
// One limit, stated rather than hidden: on Windows these are `.cmd` wrappers, so
// a `spawn('node', …, { shell: false })` still resolves `node.exe` from PATH —
// CreateProcess only ever appends `.exe`. Nothing in this project spawns node
// that way (every internal spawn uses `process.execPath`), and the version gate
// refuses a chain that ended up on another major — the hole is closed by the two
// mechanisms that already exist, not by a 100 MB copy of the binary in .bin.
//
// npm rebuilds `.bin` on install, so the writers are re-run on every launcher
// pass and on `npm run setup:node` (which `prepare` runs after each install):
// removing an entry cannot rote — the next run puts it back.
// ─────────────────────────────────────────────────────────────────────────────
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where npm puts the project's executables — and where the pin now lives. */
export const binDirFor = (root) => join(root, 'node_modules', '.bin');

/**
 * The private PATH shim directory this module replaces. Nothing writes there any
 * more; it is only cleaned up, so no machine keeps a second, stale mechanism
 * that could still be prepended by hand.
 */
export const legacyShimDirFor = (root) => join(root, 'node_modules', '.cache', 'pinned-node-bin');

/** POSIX shim body: `#!/bin/sh` then `exec <argv…> "$@"`. */
export const posixShimBody = (argv) =>
  `#!/bin/sh\nexec ${argv.map((a) => JSON.stringify(a)).join(' ')} "$@"\n`;

/** Windows shim body: `@echo off` then `"<argv>" %*`, with CRLF line endings. */
export const windowsShimBody = (argv) =>
  `@echo off\r\n${argv.map((a) => `"${a}"`).join(' ')} %*\r\n`;

/**
 * The three commands the pin owns. `npx` is its own entry point when npm ships
 * one; older/standalone layouts only have npm-cli.js, and `npx` through npm
 * still resolves dependencies fine.
 *
 * @param {string} execPath pinned node binary
 * @param {string} npmEntry npm-cli.js
 * @returns {Record<string, string[]>}
 */
export function shimTargets(execPath, npmEntry) {
  const npxCliJs = join(dirname(npmEntry), 'npx-cli.js');
  return {
    node: [execPath],
    npm: [execPath, npmEntry],
    npx: [execPath, existsSync(npxCliJs) ? npxCliJs : npmEntry],
  };
}

/**
 * Write (or refresh) the three entries in `node_modules/.bin`, and return that
 * directory. Idempotent: a file whose content already matches is left untouched,
 * so repeated runs do not churn mtimes.
 *
 * @param {object} options
 * @param {string} options.root project root
 * @param {string} options.execPath pinned node binary
 * @param {string} options.npmEntry npm-cli.js exposed as `npm` (and `npx`)
 * @returns {string} the directory npm already prepends to every script's PATH
 */
export function writeBinShims({ root, execPath, npmEntry }) {
  const dir = binDirFor(root);
  mkdirSync(dir, { recursive: true });
  const write = (name, body) => {
    const file = join(dir, name);
    if (existsSync(file) && readFileSync(file, 'utf8') === body) return;
    writeFileSync(file, body);
    if (!name.endsWith('.cmd')) chmodSync(file, 0o755);
  };
  for (const [name, argv] of Object.entries(shimTargets(execPath, npmEntry))) {
    write(name, posixShimBody(argv));
    write(`${name}.cmd`, windowsShimBody(argv));
  }
  return dir;
}

/** Delete the retired PATH shim directory, if a previous version created one. */
export function removeLegacyShimDir({ root }) {
  const dir = legacyShimDirFor(root);
  if (!existsSync(dir)) return false;
  try {
    rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
