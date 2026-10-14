#!/usr/bin/env node
/**
 * check-write-gates.mjs — un rôle voit-il un bouton que la BASE refuse ?
 *
 *   npm run check:write-gates            (lecture seule ; 0 = aligné, 1 = écart)
 *   npm run check:write-gates -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * Trois défauts mesurés, tous de la même famille — un écran et la base ne
 * disaient pas la même chose :
 *
 *   • 2026-10-05 : un compte `econome` enregistrait la paie hors ligne ; chaque
 *     rejeu revenait en `42501` et les saisies restaient dans la file. Rien ne
 *     cassait : l'écran proposait une écriture que la base refusait ;
 *   • 2026-10-13 : le Gestionnaire Principal et l'économe étaient refusés sur
 *     `staff` et `vendor_expenses` pendant que l'écran leur cachait l'action ;
 *   • le même jour, `expenses` ACCEPTAIT l'économe alors que l'icône « Ajouter
 *     une dépense » ne s'affichait pas chez lui.
 *
 * `check:rls-policies` compare les politiques de la BASE à celles des migrations,
 * et `tests/finance-rights.test.ts` compare les listes de l'app aux fonctions des
 * migrations : les deux pouvaient être verts pendant que les deux moitiés
 * divergeaient, parce que personne ne les CROISAIT.
 *
 * ─── Ce qu'elle croise ──────────────────────────────────────────────────────
 * Ce que l'app ÉCRIT (`src/lib/dataOps/*.ts` : `.from('t').insert/update/delete`,
 * `.rpc('f')`) × les PORTES D'AFFICHAGE (`scripts/lib/write-gates.mjs`, dont
 * l'inventaire nomme l'écran, l'action et la garde qu'il lit) × ce que la BASE
 * ACCORDE (les politiques d'écriture rejouées depuis les migrations, chaque
 * condition résolue en un ensemble de rôles lu dans les fonctions de rôle).
 *
 * Deux verdicts, nommés rôle par rôle :
 *   ❌ l'écran montre ce que la base refuse → la file, puis le 42501 ;
 *   ❌ la base accepte ce que l'écran cache → une capacité muette (celle du
 *      2026-10-13 sur `expenses`). Un écart VOULU se DÉCLARE (`narrower`, avec
 *      sa raison) et s'imprime à chaque exécution — jamais un silence.
 *
 * ─── Ce qu'elle ne fait pas ─────────────────────────────────────────────────
 * Elle ne corrige rien : un écart de droits se tranche (une migration, une garde
 * d'écran), et un contrôle qui réécrit effacerait la preuve de ce qu'il a trouvé.
 * Elle ne lit AUCUNE base : les migrations sont la source de vérité des droits, et
 * `check:rls-policies` prouve déjà que la base porte ces politiques-là.
 *
 * Sortie : 0 = aligné ; 1 = écart nommé ou inventaire incomplet ; 2 = pas de
 * verdict possible (corpus vide, condition illisible). « Je n'ai pas pu
 * regarder » n'est pas un vert.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_OPS_PREFIX, NARROWED_LABEL, WRITE_GATE_INVENTORY, judgeWriteGates } from './lib/write-gates.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');
const DATA_OPS_DIR = join(root, 'src', 'lib', 'dataOps');

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Croiser les politiques d'écriture de la base avec les portes d'affichage de l'app.

  npm run check:write-gates [options]

  (aucune option)   croiser, nommer chaque écart, sortir en 1 s'il y en a un
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Cette commande n'écrit RIEN : ni en base, ni ailleurs. Elle lit les migrations
(supabase/migrations) et la source (src/lib/dataOps, les écrans nommés par
l'inventaire, les listes de rôles de src/lib/*Rights.ts).`);
  process.exit(0);
}

/**
 * Les rôles qu'un écart cache, sans dire deux fois la même chose : « tout compte
 * connecté » est déjà son propre libellé.
 */
const spread = (item) => {
  const roles = item.roles.join(', ');
  return roles === item.base ? roles : `${roles} (${item.base})`;
};

/** Un fichier lu, ou `null` — un fichier absent est un problème nommé, pas une exception. */
function read(relative) {
  try {
    return readFileSync(join(root, relative), 'utf8');
  } catch {
    return null;
  }
}

// ── La couche d'écriture : toutes les écritures de l'app, sans liste à tenir.
const dataOpsFiles = (() => {
  try {
    return readdirSync(DATA_OPS_DIR)
      .filter((name) => name.endsWith('.ts'))
      .sort()
      .map((name) => `${DATA_OPS_PREFIX}${name}`);
  } catch {
    return [];
  }
})();

// ── Les fichiers que l'inventaire NOMME : chaque écran, et la liste de rôles
//    que sa porte cite. Ce sont exactement ceux dont le jugement a besoin.
const named = new Set(dataOpsFiles);
for (const entry of WRITE_GATE_INVENTORY) {
  named.add(entry.screen);
  if (entry.gate?.file) named.add(entry.gate.file);
}

const sources = [];
const unread = [];
for (const file of named) {
  const text = read(file);
  if (text === null) unread.push(file);
  else sources.push({ file, text });
}

// ── Les migrations : la source de vérité des droits.
const migrationFiles = (() => {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
})();
const migrations = migrationFiles.map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));

const report = judgeWriteGates({ sources, migrations });

if (unread.length > 0) {
  report.problems.push(
    `fichier(s) nommé(s) par l’inventaire et INTROUVABLE(S) : ${unread.join(', ')} — une porte dont l’écran n’existe plus ne garde rien.`,
  );
  report.ok = false;
}

if (AS_JSON) {
  process.stdout.write(
    `${JSON.stringify(
      {
        migrations: migrations.length,
        dataOpsFiles: dataOpsFiles.length,
        sources: sources.length,
        entries: report.entries,
        actions: report.actions,
        rpcs: report.rpcs,
        policies: report.policies,
        roleListsRead: report.roleListsRead,
        shownOverPromises: report.shownOverPromises.map((item) => ({
          key: item.key,
          action: item.action,
          screen: item.screen,
          roles: item.roles,
          app: item.app,
          base: item.base,
          source: item.source,
        })),
        hiddenGrants: report.hiddenGrants.map((item) => ({
          key: item.key,
          action: item.action,
          screen: item.screen,
          roles: item.roles,
          app: item.app,
          base: item.base,
          source: item.source,
        })),
        noWritePolicy: report.noWritePolicy.map((item) => ({ key: item.key, action: item.action, screen: item.screen, base: item.base })),
        unproven: report.unproven.map((item) => ({ key: item.key, action: item.action, screen: item.screen, why: item.why })),
        narrowed: report.narrowed.map((item) => ({ key: item.key, action: item.action, screen: item.screen, roles: item.roles, reason: item.narrower })),
        illegible: report.illegible.map((item) => ({ key: item.key, action: item.action, source: item.source })),
        problems: report.problems,
        drift: report.drift,
        vacuous: report.vacuous,
      },
      null,
      2,
    )}\n`,
  );
} else {
  console.log('Portes d’affichage × politiques d’écriture');
  console.log(`Migrations lues                       : ${migrations.length}`);
  console.log(`Fichiers de la couche d’écriture      : ${dataOpsFiles.length}`);
  console.log(`Écritures croisées (table, commande)  : ${report.actions} (+ ${report.rpcs} fonction(s))`);
  console.log(`Portes d’affichage déclarées          : ${report.entries}`);
  console.log(`Listes de rôles lues dans l’app       : ${report.roleListsRead}`);
  console.log(`Couples (table, commande) de la base  : ${report.policies}`);

  for (const item of report.shownOverPromises) {
    console.log(`   ❌ L’ÉCRAN MONTRE CE QUE LA BASE REFUSE — ${item.key}`);
    console.log(`        « ${item.action} » (${item.screen}) est offerte à : ${item.app}`);
    console.log(`        la base n’accorde cette écriture qu’à : ${item.base}`);
    console.log(`        rôles en trop : ${item.roles.join(', ')} — chaque écriture sera refusée (42501)`);
    console.log(`        droits lus dans : ${item.source}`);
  }
  for (const item of report.hiddenGrants) {
    console.log(`   ❌ LA BASE ACCEPTE CE QUE L’ÉCRAN CACHE — ${item.key}`);
    console.log(`        « ${item.action} » (${item.screen}) n’est offerte qu’à : ${item.app}`);
    console.log(`        la base l’accorde aussi à : ${spread(item)}`);
    console.log(`        droits lus dans : ${item.source}`);
    console.log('        si l’écart est VOULU, déclarez-le (`narrower`, avec sa raison) dans l’inventaire.');
  }
  for (const item of report.noWritePolicy) {
    console.log(`   ❌ AUCUNE POLITIQUE D’ÉCRITURE — ${item.key}`);
    console.log(`        « ${item.action} » (${item.screen}) — ${item.base}.`);
    console.log('        Un écran qui offre une écriture sans politique promet un 42501.');
  }
  for (const item of report.unproven) {
    console.log(`   ❌ PORTE NON PROUVÉE — ${item.key}`);
    console.log(`        ${item.why}`);
    console.log('        Une garde déclarée que l’écran ne lit pas ne garde rien.');
  }
  for (const item of report.narrowed) {
    console.log(`   · ${NARROWED_LABEL} — ${item.key}`);
    console.log(`        « ${item.action} » (${item.screen}) : ${item.app}`);
    console.log(`        la base accorde en plus : ${spread(item)}`);
    console.log(`        raison déclarée : ${item.narrower}`);
  }
  for (const item of report.illegible) {
    console.log(`   ⚠️  CONDITION ILLISIBLE — ${item.key} : ${item.source}`);
  }
  for (const problem of report.problems) console.log(`   ⚠️  ${problem}`);
}

if (report.vacuous) {
  console.error(
    '\n❌ Le croisement n’a rien atteint (aucun inventaire, aucune écriture lue, aucune politique déclarée, ou\n' +
      '   aucune liste de rôles lisible) — un contrôle qui n’a pas lu son corpus ne prouve rien.\n' +
      '   « Je n’ai pas pu regarder » n’est pas un vert.',
  );
  process.exit(2);
}

if (report.illegible.length > 0) {
  console.error(
    `\n❌ ${report.illegible.length} condition(s) d’écriture que ce contrôle n’a pas su lire — il REFUSE de conclure :\n` +
      '   devinez la règle serait pire que le défaut. Ajoutez la forme à `resolveCondition` (scripts/lib/write-gates.mjs)\n' +
      '   plutôt que de déclarer l’écart aligné.',
  );
  process.exit(2);
}

if (report.ok) {
  // En mode `--json`, la sortie standard porte le rapport SEUL : le résumé
  // humain part sur `stderr`, pour qu'un appelant puisse lire le JSON sans
  // avoir à retirer une ligne de prose qui ne se parse pas.
  const summary = (...parts) => (AS_JSON ? console.error(...parts) : console.log(...parts));
  summary(
    `\n✅ les ${report.entries} portes d’affichage s’accordent avec les ${report.policies} couples (table, commande)\n` +
      `   que les migrations déclarent — ${report.actions} écriture(s) de la couche dataOps et ${report.rpcs} fonction(s) croisées,` +
      (report.narrowed.length > 0
        ? `\n   ${report.narrowed.length} écart(s) DÉCLARÉ(S) (l’écran plus étroit que la base), nommé(s) ci-dessus.`
        : '\n   aucun écart déclaré.'),
  );
  process.exit(0);
}

console.error(
  `\n❌ ${report.drift} écart(s) entre les portes d’affichage et les politiques d’écriture de la base — chacun est NOMMÉ ci-dessus :\n` +
    '   • L’ÉCRAN MONTRE CE QUE LA BASE REFUSE : la saisie entrera en file hors ligne, puis sera refusée en 42501 —\n' +
    '     la garde de l’écran lit une liste qui ne correspond plus à la politique (ou l’inverse) ;\n' +
    '   • LA BASE ACCEPTE CE QUE L’ÉCRAN CACHE : une capacité muette. Si c’est voulu, déclarez-la (`narrower`, avec\n' +
    '     sa raison) dans `scripts/lib/write-gates.mjs` ; sinon l’écran doit suivre la base ;\n' +
    '   • PORTE NON PROUVÉE : l’écran ne lit pas la garde que l’inventaire lui prête — la garde est une intention.\n' +
    '\n   Trancher un écart, c’est une décision de droits : une migration (puis `db:apply`) ou une garde d’écran.\n' +
    '   Ce contrôle ne corrige rien.',
);
process.exit(1);
