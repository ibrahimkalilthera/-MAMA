/**
 * ─── Workflow-syntax gate — un workflow que YAML refuse ne tourne PAS ────────
 *
 * Chaque garde de ce dépôt vit dans un workflow ; si le fichier du workflow
 * refuse de se parser, GitHub tue CHAQUE run au démarrage — **zéro job, aucun
 * log**, une conclusion « failure » illisible — sur toutes les branches et pour
 * tous les déclencheurs. Un contrôle mort ne dit pas qu'il est mort : il
 * ressemble à un contrôle qui ne trouve rien.
 *
 * POURQUOI CETTE PORTE EXISTE, ET CE QU'ELLE A COÛTÉ
 * -------------------------------------------------
 * Le 2026-10-14, `014baeb` (1.0.32) a ajouté à `public-rls-watch.yml` deux noms
 * d'étape en français qui portent un ` : ` NON QUOTÉ :
 *
 *   `- name: Gate — politiques RLS : la base porte-t-elle …`
 *
 * YAML y voit une clé au milieu d'une valeur et refuse le fichier entier. La
 * veille « une table de public sans RLS » — celle qui existe parce que la clé
 * PUBLIQUE du site avait rendu 14 lignes d'élèves, de parents et de notes
 * médicales — est restée morte DEUX JOURS. Le dernier run vert était le cron du
 * matin, sur le commit d'avant ; tous les runs suivants étaient des pushes, tous
 * en échec au démarrage, y compris ceux des onze branches Dependabot, ce qui a
 * fait accuser Dependabot d'un rouge qui venait de nous.
 *
 * Rien dans le dépôt ne pouvait le dire : la chaîne qualité lit ces fichiers
 * pour y comparer des COMMANDES (`check-ci-commands.mjs`), jamais pour les
 * parser ; l'audit des automatisations lit des PREUVES, et un workflow qui ne
 * démarre pas n'en publie aucune — donc il ne l'accuse pas non plus.
 *
 * CE QUE LA PORTE JUGE, ET CE QU'ELLE NE JUGE PAS
 * ----------------------------------------------
 * La règle vit dans `scripts/lib/workflow-scalars.mjs` : elle cherche la SEULE
 * classe qui tue un workflow au démarrage — un scalaire non quoté qui porte `: `
 * — et rien d'autre. Ce n'est pas un parseur YAML et elle ne le prétend pas :
 * elle est calibrée pour être propre sur les vingt workflows du dépôt (923
 * scalaires examinés, 0 accusé le jour où elle est née), parce qu'un garde qui
 * rougit sur du code légitime est un garde qu'on contourne.
 *
 * Sa vacuité est DOUBLE et écrite : aucun fichier lu (`assertScanned`), ou aucun
 * scalaire EXAMINÉ (sortie 2) — une règle qui ne regarde plus rien n'est pas un
 * vert.
 *
 * Usage: node scripts/check-workflow-syntax.mjs   (branché dans `npm run lint`)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { WORKFLOW_DIR } from './lib/ci-commands.mjs';
import { assertScanned } from './lib/source-text.mjs';
import { countMappingScalars, findBrokenScalars } from './lib/workflow-scalars.mjs';

const root = process.cwd();

/**
 * Les fichiers de workflow, à plat. Un dossier illisible est une ERREUR, jamais
 * une liste vide : un chemin qu'on n'atteint plus ne doit pas se lire « rien à
 * me reprocher ».
 */
function workflowFiles() {
  let names;
  try {
    names = readdirSync(join(root, WORKFLOW_DIR));
  } catch {
    console.error(`❌ ${WORKFLOW_DIR}/ est illisible — la porte ne peut rien prouver.`);
    process.exit(1);
  }
  return names
    .filter((name) => /\.ya?ml$/.test(name))
    .sort()
    .map((name) => `${WORKFLOW_DIR}/${name}`);
}

const files = workflowFiles();
assertScanned(files, { what: 'fichier de workflow', root: WORKFLOW_DIR });

let examined = 0;
const findings = [];
for (const file of files) {
  const text = readFileSync(join(root, file), 'utf8');
  examined += countMappingScalars(text);
  for (const hit of findBrokenScalars(text)) findings.push({ file, ...hit });
}

if (examined === 0) {
  console.error(
    '❌ Rien à juger : aucun scalaire de workflow lu — la forme des lignes a changé,\n' +
      '   ou le lecteur ne les atteint plus. Un corpus vide n’est pas un vert.',
  );
  process.exit(2);
}

if (findings.length > 0) {
  console.error(`❌ ${findings.length} scalaire(s) que YAML refuse — ce fichier ne PEUT PAS tourner :`);
  for (const f of findings) {
    console.error(`   ${f.file}:${f.line}  (clé « ${f.key} »)`);
    console.error(`        ${f.text.slice(0, 140)}`);
  }
  console.error(
    '\n   Un `:` suivi d’une espace dans une valeur NON QUOTÉE fait lire au parseur une\n' +
      '   clé au milieu d’une valeur : il refuse le fichier entier, et GitHub tue\n' +
      '   alors CHAQUE run au démarrage — zéro job, aucun log, sur toutes les branches.\n' +
      '   → Quoitez la valeur (`name: \'… : …\'`) ou retirez le `:` ; un marqueur ne\n' +
      '     doit pas dépendre de la ponctuation d’une phrase.',
  );
  process.exit(1);
}

console.log(
  `✅ ${files.length} workflow(s) acceptés par YAML : ${examined} scalaire(s) examiné(s), ` +
    'aucun `: ` hors guillemets.',
);
