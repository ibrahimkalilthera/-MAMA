#!/usr/bin/env node
/**
 * Node-version parity gate — the local chain must run the SAME major as CI.
 *
 * Why a gate and not just an `engines` hint: a green local chain on the wrong
 * major is a FALSE green. Real incident (2026-09-11): the suite passed on Node
 * 24 locally and failed on the CI's Node 22 — `mock.module('node:fs', { exports })`
 * breaks the ESM named-export interop on 22 only — so two pushes were rejected
 * by the quality gate and the Vercel deploys stayed blocked while the local
 * hook kept saying everything was fine.
 *
 * Single source of truth: `.nvmrc` (read by nvm/fnm/asdf, and by every
 * workflow's `actions/setup-node` via `node-version-file`). `engines.node` in
 * package.json must agree with it — drift there fails this gate too.
 *
 * Placed FIRST in `npm run lint` (pre-commit + pre-push + CI quality job): a
 * mismatch fails immediately with the remedy instead of surfacing as a red CI
 * run minutes later. `npm test` is deliberately left free, so a suite can
 * still be replayed under another major (`npx --yes node@22 …`) when
 * diagnosing exactly this kind of divergence.
 *
 * `engine-strict=true` is deliberately NOT set in .npmrc: it turns any
 * transitive dependency's `engines` range into a fatal install error, and our
 * own field would then block `npm install` on every other major — including
 * the ephemeral Node 22 used for CI replays. This gate covers the path that
 * lied (the local quality chain).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Major version number of a `vX.Y.Z` / `X.Y.Z` / `>=X.Y.Z <Z…` string, or null
 * when no number can be read (the gate then stays silent rather than blocking
 * on a malformed pin).
 * @param {unknown} value
 * @returns {number | null}
 */
export function majorOf(value) {
  const m = String(value ?? '').match(/\d+/);
  return m ? Number(m[0]) : null;
}

/**
 * The mismatch to report, or null when `current` runs the same major as
 * `pinned` — and also when either side is unparsable (best-effort: a gate must
 * never wedge the chain on input it cannot read).
 * @param {string} current
 * @param {string} pinned
 * @returns {{ current: number, pinned: number } | null}
 */
export function mismatch(current, pinned) {
  const c = majorOf(current);
  const p = majorOf(pinned);
  if (c === null || p === null || c === p) return null;
  return { current: c, pinned: p };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const pinned = readFileSync(join(root, '.nvmrc'), 'utf8');
  const engines = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).engines?.node ?? '';
  const problems = [];

  const local = mismatch(process.versions.node, pinned);
  if (local) {
    problems.push(
      `Node ${process.versions.node} ici (majeur ${local.current}), alors que la CI et .nvmrc épinglent le majeur ${local.pinned}.`,
    );
  }
  if (majorOf(pinned) !== majorOf(engines)) {
    problems.push(
      `engines.node (${engines || 'absent'}) ne correspond pas à .nvmrc (${String(pinned).trim()}).`,
    );
  }

  if (problems.length > 0) {
    console.error('');
    for (const p of problems) console.error(`❌ ${p}`);
    console.error('');
    console.error("   Un « vert » local sur un autre majeur n'engage rien : c'est exactement");
    console.error('   comme ça que deux pushes ont été rejetés par la CI le 2026-09-11.');
    console.error('   Remède :');
    console.error('     nvm install && nvm use        (ou fnm/asdf — ils lisent .nvmrc)');
    console.error('     npx --yes node@22 <commande>  (vérification ponctuelle, sans changer de version)');
    console.error('   Détail : README.md § « Version de Node — pourquoi 22 ? ».');
    console.error('');
    process.exit(1);
  }

  console.log(`✅ Node ${process.versions.node} — majeur ${majorOf(pinned)} attendu, .nvmrc et engines d'accord.`);
}
