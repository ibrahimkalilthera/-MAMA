#!/usr/bin/env node
/**
 * setup-node-runtime.mjs — provision the Node runtime this project pins.
 *
 * `npm run setup:node` resolves (and, if needed, provisions through npm) the
 * node major pinned in `.nvmrc`, records its absolute path in the ignored cache
 * so later runs are instant, and prints what it found. No version manager, no
 * admin rights, no system-wide install — the point is that a developer who
 * clones this project is not asked to install tooling by hand before their
 * commits can pass.
 *
 * Flags:
 *   --check   resolve and report only; never provision from the network
 *   --soft    never fail the caller (used by `prepare`, so a fresh `npm install`
 *             that happens to be offline still succeeds)
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import {
  cacheFileFor,
  majorOf,
  pinnedMajor,
  readCachedExecPath,
  resolveNodeRuntime,
} from './lib/node-runtime.mjs';

const root = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const checkOnly = args.has('--check');
const soft = args.has('--soft');

const pinned = pinnedMajor(root);
const major = majorOf(pinned);
const cacheFile = cacheFileFor(root);

try {
  const runtime = resolveNodeRuntime({
    currentExecPath: process.execPath,
    currentVersion: process.versions.node,
    pinned,
    cacheFile,
    // --check reports the truth offline: no provisioning, only what is already
    // resolvable (the running node or a cached path).
    ...(checkOnly ? { fetchNpm: (m) => readCachedExecPath(cacheFile, m) } : {}),
  });
  const origin = {
    current: `le Node courant le fait déjà (${process.versions.node})`,
    cache: 'retrouvé dans le cache local',
    npm: 'provisionné et mis en cache',
  }[runtime.source];
  console.log(`✅ Node ${major} prêt — ${origin}.`);
  console.log(`   ${runtime.execPath}`);
  if (runtime.source === 'current') {
    console.log('   Rien à faire : la CI et les hooks utiliseront ce runtime tel quel.');
  }
} catch (error) {
  if (soft) {
    console.warn(`⚠️  Node ${major} indisponible — ${error.message.split('\n')[0]}`);
    console.warn('   Les hooks et les gates le tenteront à nouveau au moment voulu.');
    process.exit(0);
  }
  if (checkOnly) {
    console.error(`❌ Node ${major} introuvable hors ligne (cache : ${existsSync(cacheFile) ? 'présent' : 'absent'}).`);
  }
  console.error(`❌ ${error.message}`);
  process.exit(1);
}
