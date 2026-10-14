#!/usr/bin/env node
/**
 * check-e2e-targets.mjs — « un contrôle n'a rien à écrire chez le client »,
 * exécutable.
 *
 *   npm run check:e2e-targets          (dans la chaîne qualité)
 *   npm run check:e2e-targets -- --verbose
 *
 * ─── Ce qui s'est payé, et ce que ce contrôle empêche de repayer ────────────
 * Le 2026-10-12, `business-e2e.yml` et `pdf-e2e.yml` ont reçu leur propre pile :
 * plus un compte éphémère, plus une ligne de démo dans la base de l'école. La
 * règle qui l'a imposé — « un contrôle n'a rien à écrire chez le client » —
 * n'était pourtant écrite nulle part qui puisse la refuser : il suffisait qu'un
 * job repoionte la base partagée pour que l'école retrouve des élèves de
 * démonstration dans ses comptes, sans qu'aucun contrôle ne rougisse.
 *
 * Ce garde lit les workflows et refuse, dans un job qui PILOTE l'application ou
 * le binaire sous test, les cinq formes d'une cible qui n'appartient pas au job :
 * un hôte Supabase hébergé nommé en dur, une cible prise dans un secret,
 * l'absence de pile montée par le job, l'absence — ou le retard — du garde
 * `check:recette-base`, une écriture pilotée hors loopback. Les veilles qui
 * visent la base réelle À DESSEIN (sauvegarde, comptes propriétaires, garde
 * anon) ne sont pas jugées par ces règles : elles sont DÉCLARÉES, avec leur
 * raison, et nommées dans le rapport. Le détail vit dans
 * `scripts/lib/e2e-target.mjs`.
 *
 * Deux sorties à ne pas confondre : **1** = une violation trouvée (« c'est
 * faux »), **2** = une vérification impossible (« je n'ai pas pu regarder ») —
 * aucun workflow lu, aucune invocation de script, aucun E2E jugé. Un contrôle
 * qui ne juge rien et sort en vert est le mensonge le plus coûteux du lot.
 *
 * Limite assumée : c'est un contrôle de TEXTE. Il prouve où un job DIT qu'il
 * écrit ; ce qui a réellement été écrit ce jour-là est compté par
 * `verify-ephemeral-cleanup.mjs`, qui lit la base visée.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { WORKFLOW_DIR } from './lib/ci-commands.mjs';
import {
  E2E_DRIVERS,
  EXCEPTIONS,
  PRODUCTION_PROBES,
  READ_ONLY_INVOCATIONS,
  auditClassification,
  auditExceptions,
  auditReadOnlyDeclarations,
  formatE2eTargetReport,
  judgeWorkflow,
  scriptInvocations,
  scriptWrites,
} from './lib/e2e-target.mjs';
import { assertScanned } from './lib/source-text.mjs';

const root = process.cwd();
const VERBOSE = process.argv.includes('--verbose');

/** Le contenu d'un fichier, ou null s'il n'est pas lisible. */
function readOrNull(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

const pkg = JSON.parse(readOrNull(join(root, 'package.json')) ?? '{}');

/**
 * Tous les workflows, en texte. Un dossier illisible est une ERREUR, pas une
 * liste vide : c'est la faute qui a déjà coûté un contrôle inerte à ce dépôt.
 */
function readWorkflows() {
  let names;
  try {
    names = readdirSync(join(root, WORKFLOW_DIR));
  } catch {
    console.error(`❌ ${WORKFLOW_DIR}/ est illisible — ce contrôle ne peut rien prouver.`);
    process.exit(2);
  }
  return names
    .filter((n) => /\.ya?ml$/.test(n))
    .sort()
    .map((n) => ({ file: `${WORKFLOW_DIR}/${n}`, text: readOrNull(join(root, WORKFLOW_DIR, n)) ?? '' }));
}

const workflows = readWorkflows();
// Un scan vide n'est pas un vert : une racine déplacée laisserait ce contrôle
// imprimer « aucun E2E n'écrit chez l'école » sans avoir lu une ligne.
assertScanned(workflows, { what: 'workflow(s) YAML lus', root: `${WORKFLOW_DIR}/` });

// Ce qui doit être CLASSÉ n'est pas une liste tenue à la main : c'est ce que la
// CI appelle et qui écrit. Le verdict est lu sur la source du script
// (`judgeWrites`) et mis en cache — une source parcourue une fois suffit.
const writesVerdicts = new Map();
const missingScripts = new Set();
function writes(script) {
  if (!writesVerdicts.has(script)) {
    const source = readOrNull(join(root, script));
    if (source === null) {
      missingScripts.add(script);
      writesVerdicts.set(script, false);
    } else {
      writesVerdicts.set(script, scriptWrites({ file: script, source }));
    }
  }
  return writesVerdicts.get(script);
}

const driverScripts = new Set(E2E_DRIVERS.map((e) => e.script));
const probeScripts = new Set(PRODUCTION_PROBES.map((e) => e.script));
const isDriver = (script) => driverScripts.has(script);
const isProbe = (script) => probeScripts.has(script);

const results = workflows.map((w) =>
  judgeWorkflow({ file: w.file, text: w.text, scripts: pkg.scripts ?? {}, isDriver, isProbe }),
);

// Toutes les invocations du dépôt : elles servent au classement (quels scripts
// d'écriture la CI appelle) et aux déclarations de lecture seule.
const allInvocations = workflows.flatMap((w) =>
  scriptInvocations({ file: w.file, text: w.text, scripts: pkg.scripts ?? {} }),
);
const invokedWriters = [...new Set(allInvocations.filter((inv) => writes(inv.script)).map((inv) => inv.script))].sort();

const usedReadOnly = new Set();
for (const inv of allInvocations) {
  for (const flag of inv.args) usedReadOnly.add(`${inv.script} ${flag}`);
}
const readOnlySources = {};
for (const script of new Set(READ_ONLY_INVOCATIONS.map((e) => e.script))) {
  const source = readOrNull(join(root, script));
  if (source !== null) readOnlySources[script] = source;
}

const scanned = {
  workflows: workflows.length,
  judged: results.filter((r) => r.judged).length,
  invocations: results.reduce((n, r) => n + r.invocations.length, 0),
};

const { problems: exceptionProblems, tolerated } = auditExceptions({ exceptions: EXCEPTIONS, results });
const classificationProblems = auditClassification({ invokedWriters });
const readOnlyProblems = auditReadOnlyDeclarations({
  declared: READ_ONLY_INVOCATIONS,
  sources: readOnlySources,
  used: usedReadOnly,
});
// Un workflow qui appelle un script absent ne peut pas être jugé — le dire est
// la seule réponse honnête : ni vert par ignorance, ni rouge par fantôme.
for (const script of missingScripts) {
  classificationProblems.push(
    `${script} — appelé par un workflow mais introuvable dans scripts/ : ce contrôle ne peut pas dire s’il écrit.`,
  );
}

if (VERBOSE) {
  for (const r of results) {
    console.log(
      `${r.file} — ${r.invocations.length} invocation(s), ${r.writers.length} pilotage(s)` +
        (r.judged ? ` · jugé (${r.rules.join(', ') || 'aucun refus'})` : ' · hors règle E2E'),
    );
    for (const ro of r.readOnly) console.log(`   ➖ lecture seule : ${ro.command} (${ro.excuse.flag})`);
  }
  console.log(`   scripts d’écriture appelés par la CI (${invokedWriters.length}) : ${invokedWriters.join(', ')}`);
}

const report = formatE2eTargetReport({
  results,
  scanned,
  exceptions: EXCEPTIONS,
  exceptionProblems,
  classificationProblems,
  tolerated,
  readOnlyProblems,
});
for (const line of report.lines) {
  if (line.error) console.error(line.text);
  else console.log(line.text);
}

if (report.vacuous) process.exit(2);
if (report.failed) {
  console.error(
    '\n   Un E2E monte SA pile (`supabase start`, clés éphémères rendues par `supabase status -o env`),' +
      '\n   passe `npm run check:recette-base` AVANT sa première écriture, et sert son build en local.' +
      '\n   La base de l’école n’est ni lue ni écrite par un contrôle. Une dérogation doit nommer' +
      '\n   le workflow, dire pourquoi, et couvrir exactement les refus observés.',
  );
  process.exit(1);
}
