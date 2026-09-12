/**
 * Garde-fou « les sentinelles des contrôles ».
 *
 *   npm run check:gate-sentinels        (dans la chaîne qualité, donc en CI)
 *
 * Ce qu'il refuse : qu'un fichier — une suite de tests, un script — IMPRIME une
 * sentinelle qu'un contrôle relit dans les journaux de runs. Voir
 * scripts/lib/gate-sentinels.mjs pour la règle, l'inventaire et l'incident.
 *
 * Portée : tout ce qui s'exécute dans un job — `tests/` et `scripts/` —, les
 * fichiers de `src/` n'ayant rien à faire dans un journal de CI.
 *
 * Usage : node scripts/check-gate-sentinels.mjs   (wired into `npm run lint`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSentinelReport, inspectSentinelPrinters } from './lib/gate-sentinels.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_FILE = /\.test\.tsx?$/;

/** Tous les fichiers d'un dossier, récursivement, par extension. */
function walk(dir, accept) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, accept));
    else if (accept(name)) out.push(full);
  }
  return out;
}

/**
 * Les fichiers jugés. Un dossier illisible est un ÉCHEC, jamais une liste vide :
 * un contrôle qui n'a rien pu lire doit le dire (c'est la leçon du `git.cmd`
 * inerte et du contraste « non applicable »).
 */
function readFiles() {
  const targets = [
    ...walk(join(ROOT, 'tests'), (n) => /\.tsx?$/.test(n)),
    ...walk(join(ROOT, 'scripts'), (n) => /\.mjs$/.test(n)),
  ];
  return targets.map((full) => ({
    file: relative(ROOT, full).split(sep).join('/'),
    text: readFileSync(full, 'utf8'),
  }));
}

const files = readFiles();
if (!files.length) {
  // Sortie 2 et non 1 : ce n'est pas une violation trouvée, c'est une
  // vérification impossible — et un contrôle muet sur zéro fichier ressemble
  // exactement à un contrôle vert.
  console.error('❌ Rien à vérifier : aucun fichier lu dans tests/ et scripts/ — ce contrôle ne peut rien prouver.');
  process.exit(2);
}

const result = inspectSentinelPrinters({ files });
for (const line of formatSentinelReport(result, { lookFor: `tests/ et scripts/ (${TEST_FILE.source})` })) {
  if (line.startsWith('❌')) console.error(line);
  else console.log(line);
}

process.exit(result.findings.length === 0 ? 0 : 1);
