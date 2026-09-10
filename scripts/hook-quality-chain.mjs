#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/hook-quality-chain.mjs — run the pre-commit quality chain through
// the shared fork-panic retry engine (scripts/git-retry.mjs).
//
// Context: .husky/pre-commit runs the full quality chain (lint → test →
// audit). The chain itself is spawn-only and watchdog-protected, but the
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
import { pathToFileURL } from 'node:url';
import { runCommandWithRetry, parseArgs } from './git-retry.mjs';

const CHAIN = [process.execPath, 'scripts/quality-chain.mjs', 'lint', 'test', 'audit'];

/**
 * Run the quality chain with panic retry + orphan sweep before the first
 * attempt and between retries. Resolves with the chain's exit code (0 on
 * success); never rejects. The sweep is selective (quality-chain orphans only)
 * unless `sweepAll` is set.
 */
export function runHookQualityChain({
  attempts = 3,
  waitMs = 5000,
  // The chain legitimately runs several minutes (cold audit up to 10 min):
  // the per-attempt watchdog must never kill a legit run, only a wedged one.
  timeoutMs = 1500000,
  log = console.log,
  forwardStderr = true,
  sweepAll = false,
} = {}) {
  return runCommandWithRetry(CHAIN[0], CHAIN.slice(1), {
    attempts,
    waitMs,
    timeoutMs,
    log,
    forwardStderr,
    sweep: true,
    sweepAll,
  });
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { opts } = parseArgs(process.argv.slice(2));
  runHookQualityChain({
    attempts: opts.attempts,
    waitMs: opts.waitMs,
    timeoutMs: opts.timeoutMs,
    sweepAll: opts.sweepAll,
  }).then((code) => process.exit(code));
}