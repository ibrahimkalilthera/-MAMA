/**
 * Per-file line-budget gate — the split campaign's tripwire.
 *
 * A src file longer than BUDGET lines fails the lint chain, unless it is
 * listed in ALLOWLIST (grandfathered mid-split files). Each entry documents
 * the split that will retire it. When a split brings the file down to
 * BUDGET or below, its entry becomes STALE and the gate FAILS until it is
 * removed — so every retirement is a visible one-line diff inside the very
 * split commit that earns it, and the allowlist cannot silently rot.
 *
 * Scope: src/**\/*.{ts,tsx,css}. CSS is included on purpose: index.css's
 * per-theme remap split (the remap layer now lives in src/themes/overrides.css)
 * was earned by this gate, and a stylesheet can be just as unmaintainable past
 * a thousand lines as a component file.
 * (Vendored assets ride the same rule — none are near the budget today.)
 *
 * Line counting is wc-equivalent: a file ending in a newline counts its
 * lines, a trailing empty split fragment is dropped.
 *
 * Usage: node scripts/check-line-budget.mjs   (wired into `npm run lint`)
 */
import fs from 'node:fs';

import { CODE_EXTS, assertScanned, listFiles } from './lib/source-text.mjs';

const BUDGET = 700;
// La racine est surchargeable pour que le refus de vacuité soit prouvable sur
// une arborescence fabriquée (une racine vide doit ÉCHOUER, pas féliciter).
const ROOT = process.env.CHECK_LINE_BUDGET_ROOT || 'src';

// Grandfathered mid-split files. The reason names the split that retires the
// entry; delete the entry in that same split's commit (the gate fails on a
// stale entry, so forgetting is impossible).
//
// Empty since 2026-09: src/index.css section 6 (Theme Overrides) moved to
// src/themes/overrides.css, which retired the only entry that ever lived here.
const ALLOWLIST = {};

/** wc-equivalent line count: drop the empty fragment a trailing \n leaves. */
function countLines(src) {
  const parts = src.split(/\r?\n/);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

const files = listFiles(ROOT, { ext: CODE_EXTS }); // déjà préfixés par la racine
// 0 fichier lu ⇒ le budget n'a rien protégé : échec, pas un vert.
assertScanned(files, { what: 'fichier .ts/.tsx/.css', root: ROOT });
const over = [];
const stale = [];
const allowed = [];
const missing = [];

for (const rel of files) {
  const src = fs.readFileSync(rel, 'utf8');
  const lines = countLines(src);
  if (lines > BUDGET) {
    if (rel in ALLOWLIST) allowed.push({ rel, lines });
    else over.push({ rel, lines });
  } else if (rel in ALLOWLIST) {
    stale.push({ rel, lines }); // split landed — the entry must go
  }
}
for (const rel of Object.keys(ALLOWLIST)) {
  if (!files.includes(rel)) missing.push(rel);
}

let bad = 0;
for (const { rel, lines } of over) {
  bad += 1;
  console.error(`❌ ${rel} — ${lines} lignes > budget ${BUDGET} — scindez ce fichier (ou ajoutez-le à ALLOWLIST avec la raison).`);
}
for (const { rel, lines } of stale) {
  bad += 1;
  console.error(`❌ ${rel} — ${lines} lignes ≤ budget ${BUDGET} — entrée ALLOWLIST obsolète : retirez-la (le split est arrivé à terme).`);
}
for (const rel of missing) {
  bad += 1;
  console.error(`❌ ${rel} — dans ALLOWLIST mais introuvable dans src/ — retirez l'entrée.`);
}

if (bad > 0) {
  console.error(`\n${bad} fichier(s) hors budget — le budget de ${BUDGET} lignes/fichier protège la campagne de scission.`);
  process.exit(1);
}

for (const { rel, lines } of allowed) {
  console.log(`⏳ ${rel} — ${lines} lignes (grandfathered : ${ALLOWLIST[rel].split(';')[0]})`);
}
const suffix = allowed.length ? `, ${allowed.length} grandfathered` : '';
console.log(`✅ ${files.length} fichier(s) ${ROOT}/ sous le budget de ${BUDGET} lignes${suffix}.`);
