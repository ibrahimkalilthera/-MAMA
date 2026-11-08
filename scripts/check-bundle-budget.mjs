#!/usr/bin/env node
/**
 * Budget d'octets par MORCEAU livré.
 *
 * Le seul contrôle de poids existant était un score Lighthouse global : il peut
 * rester vert pendant qu'un morceau double, parce qu'un audit mobile mesure la
 * page d'entrée, pas les morceaux chargés à la demande (PDF, Excel, graphiques).
 * Ici chaque fichier produit par Vite est rangé dans une famille et comparé à un
 * budget nommé ; un dépassement échoue avec le fichier et les deux nombres.
 *
 * Usage :
 *   npm run build && node scripts/check-bundle-budget.mjs
 *   BUNDLE_DIST=electron-ui-dist node scripts/check-bundle-budget.mjs
 *
 * Les budgets vivent dans scripts/lib/bundle-budget.mjs — un seul endroit, lu
 * par le contrôle ET par son test. Les relever est une décision qui se voit
 * dans le diff ; les contourner en silence n'est pas possible.
 */
import { readdir, stat } from 'node:fs/promises';
import { join, dirname, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgetVerdict, formatBudgetReport, measureChunks } from './lib/bundle-budget.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, process.env.BUNDLE_DIST ?? 'dist');

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(full));
    } else if (['.js', '.css'].includes(extname(entry.name))) {
      const info = await stat(full);
      files.push({ path: full, bytes: info.size });
    }
  }
  return files;
}

let files;
try {
  files = await walk(join(dist, 'assets'));
} catch (err) {
  console.error(`❌ Aucun dossier « ${join(dist, 'assets')} » lisible — construisez d'abord (npm run build).`);
  console.error(`   ${err instanceof Error ? err.message : err}`);
  process.exit(2);
}

if (files.length === 0) {
  console.error(`❌ « ${join(dist, 'assets')} » ne contient aucun .js/.css : un budget sur rien ne prouve rien.`);
  process.exit(2);
}

const measured = measureChunks(files.map((file) => ({
  path: basename(file.path),
  bytes: file.bytes,
})));
const verdict = budgetVerdict(measured);

console.log(formatBudgetReport(measured, verdict));
if (!verdict.ok) {
  console.error('');
  console.error('❌ Budget de morceau dépassé :');
  for (const problem of verdict.problems) console.error(`   • ${problem}`);
  if (verdict.worst) console.error(`   Pire dépassement : ${verdict.worst}`);
  console.error('   Réduisez le morceau, ou relevez son budget DANS scripts/lib/bundle-budget.mjs (un diff visible).');
  process.exit(1);
}
console.log('✅ Tous les morceaux tiennent dans leur budget.');
