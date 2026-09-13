#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/hook-quality-chain.mjs — run the pre-commit quality chain through
// the shared fork-panic retry engine (scripts/git-retry.mjs).
//
// Context: the husky hooks (.husky/pre-commit AND .husky/pre-push) run the
// quality chain (lint → test → audit by default; the step list is overridable
// per hook). The chain itself is spawn-only and watchdog-protected, but the
// transient msys fork panic can still strike MID-RUN (a child spawn fails
// with exit 254/66 or uv_spawn EUNKNOWN), aborting the commit even though the
// code is fine. This script re-runs the chain through runCommandWithRetry
// with the orphan sweep ENABLED before the first attempt and between retries:
// the orphaned node.exe left by a watchdog timeout is exactly what keeps the
// panic alive, so sweeping it clears the panic and the commit succeeds.
//
// Real failures are NEVER masked: a lint/test/audit error (clean exit code or
// stderr) passes straight through to git with the same exit code — no retry.
// The per-attempt watchdog kills the whole tree on timeout, and the sweep
// only targets known quality-chain orphans (parent gone / older than the
// stale window), never arbitrary node.exe processes.
//
// Usage (from the hook):
//   AUDIT_CACHE=1 AUDIT_SOFT_OFFLINE=1 node scripts/hook-quality-chain.mjs
// Options (optional, for debugging): --attempts N --wait-ms N --timeout-ms N
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCommandWithRetry, parseArgs } from './git-retry.mjs';
import {
  CHAIN_CACHE_FILE,
  chainCacheVerdict,
  chainGreenRecord,
  nodeMajorOf,
} from './lib/chain-cache.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_PATH = join(ROOT, 'node_modules', '.cache', CHAIN_CACHE_FILE);

/**
 * L'arbre de contenu mis en scène (`git write-tree`) et l'état de la copie de
 * travail. Injectables pour les tests ; jamais sur un shell — un `spawnSync`
 * sans chaîne de commande, comme partout ailleurs dans ce dépôt (le shell msys
 * est précisément ce qui casse).
 */
export function gitState({
  run = (args) => {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });
    return { status: r.status ?? 1, stdout: r.stdout ?? '' };
  },
} = {}) {
  const tree = run(['write-tree']);
  const treeOid = tree.status === 0 ? tree.stdout.trim() : null;
  // `diff --name-only` (et non `--quiet`) : la sortie vide veut dire « rien de
  // non indexé », sans dépendre de la sémantique du code de sortie.
  const unstaged = run(['diff', '--name-only', '--diff-filter=ACMRTD']);
  const dirty = unstaged.status !== 0 ? true : unstaged.stdout.trim().length > 0;
  return { treeOid, dirty };
}

/** Le majeur épinglé par `.nvmrc`, ou null si illisible. */
function pinnedMajor() {
  try {
    return nodeMajorOf(readFileSync(join(ROOT, '.nvmrc'), 'utf8'));
  } catch {
    return null;
  }
}

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(record) {
  try {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify(record, null, 2));
  } catch {
    // un cache non écrit ne fait jamais échouer un commit : la chaîne tournera
    // simplement une fois de plus.
  }
}

// Steps understood by scripts/quality-chain.mjs. The hooks pass an explicit
// subset (pre-commit and pre-push both gate on the same full chain today).
export const DEFAULT_STEPS = ['lint', 'test', 'audit', 'workshop'];
export const KNOWN_STEPS = ['lint', 'l10n', 'test', 'build', 'audit', 'workshop'];
const QUALITY_CHAIN_SCRIPT = 'scripts/quality-chain.mjs';

/**
 * Run the quality chain with panic retry + orphan sweep before the first
 * attempt and between retries. Resolves with the chain's exit code (0 on
 * success); never rejects. The sweep is selective (quality-chain orphans only)
 * unless `sweepAll` is set. `platform` est injectable (tests) — défaut
 * `process.platform`.
 */
export function runHookQualityChain({
  steps = DEFAULT_STEPS,
  attempts = 3,
  waitMs = 5000,
  // The chain legitimately runs several minutes (cold audit up to 10 min):
  // the per-attempt watchdog must never kill a legit run, only a wedged one.
  timeoutMs = 1500000,
  log = console.log,
  forwardStderr = true,
  sweepAll = false,
  platform = process.platform,
  // Content-addressed skip, injection seams for the tests.
  skipVerified = undefined,
  gitStateFn = gitState,
  readCacheFn = readCache,
  writeCacheFn = writeCache,
  env = process.env,
  now = Date.now,
  // Le lanceur réel, injectable : les tests ne doivent JAMAIS démarrer la vraie
  // chaîne pour la tuer (un enfant tué laisse les orphelins node.exe qui
  // entretiennent la panique de fork que ce script existe pour absorber).
  runWithRetry = runCommandWithRetry,
} = {}) {
  const chainSteps = steps.length > 0 ? steps : DEFAULT_STEPS;

  // Déjà vérifié pour CE contenu ? Le pre-push suit presque toujours un
  // pre-commit vert sur le même arbre (le commit en fige exactement le contenu) :
  // rejouer 80 s ne peut rien apprendre. Voir scripts/lib/chain-cache.mjs pour
  // les quatre conditions, et pourquoi le doute fait toujours rejouer.
  const useSkip = skipVerified ?? env.QUALITY_SKIP_VERIFIED !== '0';
  if (useSkip) {
    const { treeOid, dirty } = gitStateFn();
    const verdict = chainCacheVerdict({
      cache: readCacheFn(),
      treeOid,
      steps: chainSteps,
      nodeMajor: pinnedMajor(),
      dirty,
      nowMs: now(),
      force: env.QUALITY_FORCE === '1' || env.QUALITY_FORCE === 'true',
    });
    if (verdict.skip) {
      log(`⏭  chaîne qualité sautée — ${verdict.reason} (QUALITY_FORCE=1 pour rejouer)`);
      return Promise.resolve(0);
    }
    log(`⏳ chaîne qualité nécessaire — ${verdict.reason}`);
  }

  return runWithRetry(process.execPath, [QUALITY_CHAIN_SCRIPT, ...chainSteps], {
    attempts,
    waitMs,
    timeoutMs,
    log,
    forwardStderr,
    sweep: true,
    sweepAll,
    platform,
    // This sweep runs for a HOOK, not for a git command: without its own
    // origin, the journal would attribute the pre-commit sweeps to the git
    // wrapper and misread where the panic actually bites.
    sweepOrigin: sweepAll ? 'hook-quality-chain:sweep-all' : 'hook-quality-chain:sweep',
  }).then((code) => {
    // Enregistré seulement sur un vert COMPLET : un maillon en échec ne doit
    // jamais laisser derrière lui un « déjà vérifié ».
    if (code === 0 && useSkip) {
      const { treeOid } = gitStateFn();
      if (treeOid) {
        writeCacheFn(chainGreenRecord({ treeOid, steps: chainSteps, nodeMajor: pinnedMajor(), nowMs: now() }));
        log(`📌 vert enregistré pour l’arbre ${treeOid.slice(0, 8)} — le prochain passage sur ce contenu sera instantané`);
      }
    }
    return code;
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { args, opts } = parseArgs(process.argv.slice(2));
  // Leftover CLI args select the steps (unknown names are ignored):
  //   node scripts/hook-quality-chain.mjs l10n
  const steps = args.filter((a) => KNOWN_STEPS.includes(a));
  runHookQualityChain({
    steps,
    attempts: opts.attempts,
    waitMs: opts.waitMs,
    // Only an EXPLICIT --timeout-ms overrides the generous default. Passing the
    // CLI default unconditionally was a real defect: it silently replaced the
    // 25-minute watchdog documented above with 300 s, so a legitimate run on a
    // loaded machine (measured: 87 s idle, several minutes under a concurrent
    // build) was killed mid-flight, retried, and could end in husky's confusing
    // `command not found (127)` — a failure of the environment reported as a
    // failure of the code.
    ...(opts.timeoutMsExplicit ? { timeoutMs: opts.timeoutMs } : {}),
    sweepAll: opts.sweepAll,
  }).then((code) => process.exit(code));
}