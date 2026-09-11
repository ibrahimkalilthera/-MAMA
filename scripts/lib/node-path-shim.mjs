// ─────────────────────────────────────────────────────────────────────────────
// scripts/lib/node-path-shim.mjs — the PATH shim that makes `node` mean the pin.
//
// Why a shim exists at all: the pinned launcher re-executes an ENTRY POINT with
// the right runtime, and the quality chain then spawns every step through
// `process.execPath`, so pinning the entry point covers the whole tree. The npm
// chain is the exception — `npm run` resolves `node`, `eslint` and `tsc` through
// PATH (the `node_modules/.bin` shims call `node`), so on another major the
// links would still run on the wrong runtime. The version gate caught exactly
// that once (a green-looking chain on Node 24), which is why the shim is not
// optional.
//
// Two details are contracts, not choices — both were paid for by a real bug:
//
//   1. Every shim is an ARGV PREFIX (`node <cli.js>`), never a bare executable.
//      Handing npm-cli.js to the OS made the audit step take its offline branch
//      and hang until its timeout instead of failing loudly.
//   2. `.cmd` files are written with CRLF. cmd.exe misparses LF-only .cmd badly
//      enough that the shim leaks back to the host runtime mid-chain.
//
// Kept in `node_modules/.cache` (ignored), rewritten only when the resolved
// runtime changes, and never needed on a machine already on the pinned major —
// there the launcher takes its fast path and writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the shims live for a given project root. */
export const shimDirFor = (root) => join(root, 'node_modules', '.cache', 'pinned-node-bin');

/** POSIX shim body: `#!/bin/sh` then `exec <argv…> "$@"`. */
export const posixShimBody = (argv) =>
  `#!/bin/sh\nexec ${argv.map((a) => JSON.stringify(a)).join(' ')} "$@"\n`;

/** Windows shim body: `@echo off` then `"<argv>" %*`, with CRLF line endings. */
export const windowsShimBody = (argv) =>
  `@echo off\r\n${argv.map((a) => `"${a}"`).join(' ')} %*\r\n`;

/**
 * Write (or refresh) the shim directory and return it, ready to be prepended to
 * PATH. Idempotent: a file whose content already matches is left untouched, so
 * repeated runs do not churn mtimes.
 *
 * @param {object} options
 * @param {string} options.root project root (the shims land under node_modules/.cache)
 * @param {string} options.execPath pinned node binary
 * @param {string} options.npmEntry npm-cli.js exposed as `npm` (and `npx`)
 * @returns {string} directory to prepend to PATH
 */
export function writePathShim({ root, execPath, npmEntry }) {
  const dir = shimDirFor(root);
  mkdirSync(dir, { recursive: true });
  const write = (name, body) => {
    const file = join(dir, name);
    if (existsSync(file) && readFileSync(file, 'utf8') === body) return;
    writeFileSync(file, body);
    if (!name.endsWith('.cmd')) chmodSync(file, 0o755);
  };
  // npx is its own entry point when npm ships one; older/standalone layouts only
  // have npm-cli.js, and `npx` through npm still resolves dependencies fine.
  const npxCliJs = join(dirname(npmEntry), 'npx-cli.js');
  const targets = {
    node: [execPath],
    npm: [execPath, npmEntry],
    npx: [execPath, existsSync(npxCliJs) ? npxCliJs : npmEntry],
  };
  for (const [name, argv] of Object.entries(targets)) {
    write(name, posixShimBody(argv));
    write(`${name}.cmd`, windowsShimBody(argv));
  }
  return dir;
}
