/**
 * Garde-fou « importer ne travaille pas ».
 *
 *   npm run check:import-effects        (dans la chaîne qualité, donc en CI)
 *
 * Ce qu'il refuse : qu'un module importé par une suite de tests exécute du
 * travail pendant son évaluation (un `main()` de niveau supérieur, un
 * `const x = build()`, un `process.on(...)`). Voir scripts/lib/import-effects.mjs
 * pour la règle et pour l'incident qui l'a rendue nécessaire — un `main()` de
 * niveau supérieur imprimait la déclaration d'inaction d'une AUTRE automatisation
 * dans le journal du job de tests, et l'audit des automatisations, qui relit ce
 * journal, accusait le mauvais workflow.
 *
 * La portée est celle qui est dangereuse, et elle est mesurée : les modules que
 * les suites importent réellement. Un script qui n'est jamais importé garde le
 * droit de tout faire au niveau supérieur — l'obliger à se garder serait une
 * convention sans conséquence.
 *
 * Usage : node scripts/check-import-effects.mjs   (wired into `npm run lint`)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatImportEffectsReport, inspectImportEffects } from './lib/import-effects.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = join(ROOT, 'tests');
const TEST_FILE = /\.test\.tsx?$/;

/** Ce qui n'est jamais un module du dépôt : les paquets et les builtins. */
const isBare = (spec) => spec.startsWith('node:') || !/^\.{1,2}\//.test(spec);

/**
 * Les spécificateurs importés par une suite : `from '…'` et `import('…')`.
 *
 * Le filtre qui compte est l'EXISTENCE du fichier, pas la forme du motif. Un
 * balayage par expression régulière a « trouvé » `scripts/thing.mjs` dans ce
 * dépôt — un exemple de fixture, cité dans une chaîne de test, qui n'existe
 * nulle part. Résoudre le chemin et exiger le fichier écarte la même classe
 * d'erreur que le garde des commandes CI a payée : lire du texte qui parle de
 * code comme s'il en était.
 */
function specifiers(text) {
  const out = [];
  for (const m of text.matchAll(/(?:from\s*|\bimport\s*\()\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out;
}

const files = readdirSync(TESTS_DIR).filter((f) => TEST_FILE.test(f)).sort();
/** @type {Record<string, string[]>} */
const importedBy = {};

for (const test of files) {
  const text = readFileSync(join(TESTS_DIR, test), 'utf8');
  for (const spec of specifiers(text)) {
    if (isBare(spec)) continue;
    const target = resolve(TESTS_DIR, spec);
    if (!target.startsWith(ROOT + sep)) continue;
    let stat;
    try {
      stat = statSync(target);
    } catch {
      continue; // un exemple cité dans une fixture n'est pas un import
    }
    if (!stat.isFile()) continue;
    const key = relative(ROOT, target).split(sep).join('/');
    (importedBy[key] ??= []).push(test);
  }
}

const result = inspectImportEffects({
  files: Object.keys(importedBy).map((file) => ({
    file,
    text: readFileSync(join(ROOT, file), 'utf8'),
  })),
  importedBy,
});

for (const line of formatImportEffectsReport(result, { lookFor: 'tests/*.test.ts' })) {
  if (line.startsWith('❌')) console.error(line);
  else console.log(line);
}

process.exit(result.findings.length === 0 && result.scanned.modules > 0 ? 0 : 1);
