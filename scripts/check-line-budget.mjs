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
 * Scope: src/**\/*.{ts,tsx,css}. CSS is included on purpose: the index.css
 * per-theme remap split is part of the same campaign, and a stylesheet can
 * be just as unmaintainable past a thousand lines as a component file.
 * (Vendored assets ride the same rule — none are near the budget today.)
 *
 * Line counting is wc-equivalent: a file ending in a newline counts its
 * lines, a trailing empty split fragment is dropped.
 *
 * Usage: node scripts/check-line-budget.mjs   (wired into `npm run lint`)
 */
import fs from 'node:fs';
import path from 'node:path';

const BUDGET = 1100;
const ROOT = 'src';
const EXT = /\.(ts|tsx|css)$/;

// Grandfathered mid-split files. The reason names the split that retires the
// entry; delete the entry in that same split's commit (the gate fails on a
// stale entry, so forgetting is impossible).
const ALLOWLIST = {
  'src/App.tsx':
    'app-shell split in progress (useNotificationWatch extracted; state cluster, helpers and JSX blocks remain)',
  'src/lib/useSupabaseData.ts':
    'per-table domain split pending (mirror of the translations split — value-identity verification planned)',
};

/** wc-equivalent line count: drop the empty fragment a trailing \n leaves. */
function countLines(src) {
  const parts = src.split(/\r?\n/);
  if (parts[parts.length - 1] === '') parts.pop();
  return parts.length;
}

/** Recursively list src/ files matching EXT, as forward-slash src-relative paths. */
function scanFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (EXT.test(e.name)) out.push(path.join(d, e.name).replace(/\\/g, '/'));
    }
  };
  walk(dir);
  return out.sort();
}

const files = scanFiles(ROOT); // already src/-prefixed, forward slashes
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
console.log(`✅ ${files.length} fichier(s) src/ sous le budget de ${BUDGET} lignes${suffix}.`);
