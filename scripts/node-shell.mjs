#!/usr/bin/env node
/**
 * node-shell.mjs — a terminal where `node` IS the runtime this project pins.
 *
 * The last gap this closes: the git hooks, `npm run lint` and `npm run quality`
 * all run on the pinned Node, but a terminal opened on the project still
 * answered `node --version` with whatever the machine had. A one-off
 * `node script.mjs`, an `npx tsc` or a debugging REPL could therefore run on
 * another major without anyone noticing — which is exactly how a local run can
 * look green and still fail in CI (see the Node 22 parity entry in
 * DEVELOPMENT_HISTORY.md).
 *
 * No version manager, no admin rights, no system-wide install: the project
 * resolves the runtime itself (scripts/lib/node-runtime.mjs, provisioning the
 * official node@<major> through npm only if needed) and puts a shim directory
 * first in PATH, so `node`, `npm` and `npx` all mean the pin.
 *
 * Usage:
 *   npm run shell                  # interactive shell on the pinned runtime
 *   npm run shell -- --print       # print the shim directory, nothing else
 *   export PATH="$(npm run --silent shell -- --print):$PATH"
 *                                  # …to pin the terminal you already have open
 *
 * `--print` exists for that last line: a shell cannot be re-parented once it is
 * running, so the honest way to pin an existing terminal is to prepend the shim
 * to its PATH. On a machine already on the pinned major this is a no-op that
 * installs nothing.
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { delimiter, dirname, resolve as resolvePath } from 'node:path';
import { resolveNpmCliJs } from './lib/npm-cli.mjs';
import { writePathShim } from './lib/node-path-shim.mjs';
import { cacheFileFor, majorOf, pinnedMajor, resolveNodeRuntime } from './lib/node-runtime.mjs';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const printOnly = process.argv.slice(2).includes('--print');

const pinned = pinnedMajor(root);

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

let npmCliJs;
try {
  npmCliJs = resolveNpmCliJs(runtime.execPath);
} catch (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const shimDir = writePathShim({ root, execPath: runtime.execPath, npmEntry: npmCliJs });

if (printOnly) {
  // Only the directory, so the caller can eval it without swallowing a banner.
  console.log(shimDir);
  process.exit(0);
}

const env = {
  ...process.env,
  MAMA_PINNED_NODE: '1',
  MAMA_NPM_CLI_JS: npmCliJs,
  // Always prepended, unlike the launcher's fast path: the whole point of this
  // entry point is that `node` means the pin, whatever PATH it was opened with.
  PATH: shimDir + delimiter + (process.env.PATH ?? ''),
};

// Which shell: on Windows the interesting case is Git Bash, where SHELL points
// at an msys path and MSYSTEM is what is actually exported (verified here: SHELL
// never reaches the child, MSYSTEM does). Order matters — the terminal the
// developer already lives in comes first, cmd.exe is the last resort — and a
// candidate that cannot be spawned falls through to the next instead of failing
// the whole entry point.
const candidates = (
  process.platform === 'win32'
    ? [process.env.SHELL, process.env.MSYSTEM ? 'bash.exe' : null, process.env.COMSPEC || 'cmd.exe']
    : [process.env.SHELL || '/bin/sh']
).filter(Boolean);

console.log(`🔧 Shell sur Node ${majorOf(pinned)} (épinglé par .nvmrc) — ${runtime.execPath}`);
if (runtime.source !== 'current') {
  console.log(`   Node du système : ${process.versions.node} (rien n'a été installé globalement).`);
}
console.log('   `node`, `npm` et `npx` pointent sur ce runtime. `exit` pour quitter.');

/** @param {number} index candidate being tried */
function launch(index) {
  const shell = candidates[index];
  const child = spawn(shell, [], { cwd: root, stdio: 'inherit', windowsHide: true, env });

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
    if (index + 1 < candidates.length) {
      console.warn(`⚠️  ${shell} introuvable (${error.message}) — repli sur ${candidates[index + 1]}.`);
      launch(index + 1);
      return;
    }
    console.error(`❌ Shell introuvable (${shell}) : ${error.message}`);
    process.exit(1);
  });

  child.on('close', (code, signal) => {
    process.exit(signal ? 1 : code ?? 0);
  });
}

launch(0);
