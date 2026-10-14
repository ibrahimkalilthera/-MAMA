#!/usr/bin/env node
/**
 * check-rls-policies.mjs — la base hébergée porte-t-elle EXACTEMENT les
 * politiques RLS que les migrations déclarent ?
 *
 *   npm run check:rls-policies            (lecture seule ; 0 = aligné, 1 = dérive)
 *   npm run check:rls-policies -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * Le 2026-10-13, deux défauts jumeaux, mesurés sur la base de l'école :
 *
 *   • `vendor_expenses` portait encore « Promoter insert vendor_expenses »
 *     (`CHECK is_admin()`) alors que `20260906000002_vendor_expense_gm_policies.sql`
 *     déclarait « Finance admins insert vendor_expenses » depuis le 2026-09-06 :
 *     la migration n'avait JAMAIS été appliquée. Le Gestionnaire Principal voyait
 *     donc le bouton « Ajouter une dépense fournisseur » et la base refusait
 *     chacune de ses écritures (42501) — pendant cinq semaines ;
 *   • `staff` refusait l'économe (`is_finance_admin()`), et l'écran citait la même
 *     liste — le défaut était invisible des deux côtés à la fois.
 *
 * Aucune garde ne pouvait le dire : `check:hosted-schema` compare les COLONNES
 * (canal PostgREST, clé anon — les politiques ne s'y lisent pas), et
 * `check:public-rls` regarde si chaque table PORTE RLS, jamais ce que la
 * politique dit. Une policy absente, en trop, ou restée à un rôle plus étroit
 * passait entre les deux en silence, indéfiniment.
 *
 * ─── Ce qu'elle compare, et par quel canal ──────────────────────────────────
 * Les POLITIQUES DÉCLARÉES sont rejouées depuis `supabase/migrations/` (la source
 * de vérité dont `db:snapshot:check` prouve déjà la cohérence) : `DROP` retire,
 * `CREATE` (re)pose, dans l'ordre des horodatages. Les politiques RÉELLES
 * viennent de `pg_policies` par connexion DIRECTE — le catalogue ne se lit pas à
 * travers PostgREST, et une lecture qui dépendrait d'une politique pour vérifier
 * les politiques serait circulaire. Le mot de passe est `SUPABASE_DB_PASSWORD`
 * (environnement, sinon `.env` lu à la main : le `--env-file` de Node tronque au
 * premier « # » non quoté, et le vrai mot de passe en contient un). `pg` n'est pas
 * une dépendance déclarée du dépôt : s'il manque, le message le dit.
 *
 * Le jugement vit dans `scripts/lib/rls-policies.mjs` — pur, donc testé sans base
 * (`tests/rls-policies.test.ts` l'exerce ROUGE sur un catalogue reconstitué).
 * Ici on lit, on nomme, on sort.
 *
 * ─── Ce qu'elle ne fait pas ────────────────────────────────────────────────
 * Elle ne corrige RIEN : une politique est une décision de droits, et un contrôle
 * qui réécrit tout seul efface la preuve de ce qu'il a trouvé. Elle NOMME, et
 * `db:apply` applique — avec sa propre preuve avant/après.
 *
 * ─── Une table RETIRÉE ne réclame plus ses politiques ──────────────────────
 * Mesuré le 2026-10-13 : elle annonçait « ABSENTE en base » pour deux politiques
 * de `custom_grades`, alors que `20260828000004_custom_classes.sql` RETIRE cette
 * table. Le corpus ne peut donc pas vouloir ces politiques, et le `DROP TABLE`
 * (écrit dans un bloc `DO $$ … $$`) lui était invisible. Elles ne sont plus
 * réclamées — et elles sont NOMMÉES dans la sortie (`· table · « nom » … retire la
 * table`) : un contrôle qui renonce en silence serait l'autre faute.
 *
 * Sortie : 0 = aligné ; 1 = dérive nommée (absente, en trop, ou changée) ;
 * 2 = pas de verdict possible (mot de passe absent, catalogue illisible, corpus
 * vide) — « je n'ai pas pu regarder » n'est pas un vert.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  POLICY_DRIFT_SQL,
  collectRoleSets,
  declaredPoliciesAndRetired,
  hostedPoliciesFromRows,
  judgePolicyDrift,
} from './lib/rls-policies.mjs';
import { connectHostedDb, readDbPassword } from './lib/hosted-db.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Comparer les politiques RLS de la base hébergée à celles des migrations.

  npm run check:rls-policies [options]

  (aucune option)   comparer, nommer chaque dérive, sortir en 1 s'il y en a une
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Cette commande n'écrit RIEN : ni en base, ni ailleurs. Une politique est une
décision de droits — nommer la dérive est son travail, pas la corriger.`);
  process.exit(0);
}

/**
 * Les politiques qu'on accepte de trouver EN BASE sans qu'une migration les
 * déclare, avec leur raison.
 *
 * Aucune aujourd'hui, et ce n'est pas un oubli : une politique permissive qui
 * n'est déclarée par rien est exactement ce que ce contrôle existe pour montrer
 * (c'est ainsi qu'une policy héritée `USING (true)` survit des mois après la
 * fermeture du trou qu'elle ouvrait). Le jour où une exception serait réclamée —
 * une policy d'outillage, par exemple — elle s'écrit ici AVEC sa raison, et le
 * jugement refuse une exemption muette, périmée, ou qui cacherait une politique
 * que les migrations déclarent.
 */
const EXEMPTIONS = [];

// La connexion (mot de passe, hôtes, tentatives) vit dans `lib/hosted-db.mjs` :
// `check-db-objects` lit LA MÊME base par LE MÊME chemin, et deux copies de cette
// convention finiraient par juger deux bases différentes — en silence.
const PASSWORD = readDbPassword(root);

// ── Ce que les migrations déclarent ──────────────────────────────────────────
const files = (() => {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => name.endsWith('.sql'))
      .sort();
  } catch {
    return [];
  }
})();
const migrations = files.map((name) => ({ name, sql: readFileSync(join(MIGRATIONS_DIR, name), 'utf8') }));
const { declared, retired } = declaredPoliciesAndRetired(migrations);
// Les fonctions de rôle (`is_admin()`, `is_finance_writer()`…) sont lues dans les
// migrations pour que `role IN ('admin','dev')` et `is_admin()` — la même règle
// écrite de deux façons — ne soient pas signalés comme une dérive.
const roleSets = collectRoleSets(migrations);

if (migrations.length === 0 || declared.size === 0) {
  console.error(
    `❌ ${migrations.length} migration(s) lue(s), ${declared.size} politique(s) déclarée(s) — ` +
      'il n’y a rien à comparer. Un contrôle qui n’a pas lu son corpus ne prouve rien.',
  );
  process.exit(2);
}
if (!PASSWORD) {
  console.error(
    '❌ SUPABASE_DB_PASSWORD absent — sans lui, la commande n’a pas de catalogue à lire.\n' +
      '   Le renseigner dans .env ou dans l’environnement. « Je n’ai pas pu regarder » n’est pas un vert.',
  );
  process.exit(2);
}

async function main() {
  const client = await connectHostedDb({ password: PASSWORD });
  let report;
  try {
    const rows = (await client.query(POLICY_DRIFT_SQL)).rows;
    const hosted = hostedPoliciesFromRows(rows);
    report = judgePolicyDrift({ declared, hosted, exemptions: EXEMPTIONS, roleSets });
  } finally {
    await client.end().catch(() => undefined);
  }

  if (AS_JSON) {
    process.stdout.write(
      `${JSON.stringify(
        {
          project: SHARED_PROJECT_REF,
          migrations: migrations.length,
          declared: report.declaredCount,
          hosted: report.hostedCount,
          matched: report.matched,
          missing: report.missing,
          extra: report.extra,
          changed: report.changed,
          retired,
          exempted: report.exempted,
          problems: report.problems,
          drift: report.drift,
          vacuous: report.vacuous,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    console.log(`Politiques RLS — base partagée ${SHARED_PROJECT_REF}`);
    console.log(`Migrations lues                   : ${migrations.length}`);
    console.log(`Fonctions de rôle lues            : ${roleSets.size}`);
    console.log(`Politiques déclarées              : ${report.declaredCount}`);
    console.log(`Politiques en base                : ${report.hostedCount}`);
    console.log(`Alignées                          : ${report.matched}`);
    // Une politique déclarée sur une table que le corpus lui-même RETIRE n'est pas
    // un manque : c'est un retrait, et il se NOMME ici plutôt que de disparaître du
    // compte sans laisser de trace.
    for (const entry of retired) {
      console.log(
        `   · ${entry.table} · « ${entry.name} » (${entry.cmd}) — déclarée par ${entry.declaredBy}, plus réclamée : ` +
          `${entry.droppedBy} retire la table`,
      );
    }
    for (const item of report.missing) {
      console.log(`   ❌ ${item.table} · « ${item.name} » — déclarée par ${item.file} (${item.cmd}), ABSENTE en base`);
    }
    for (const item of report.changed) {
      console.log(`   ❌ ${item.table} · « ${item.name} » — déclarée par ${item.file}, mais la base dit autre chose :`);
      for (const difference of item.differences) {
        console.log(`        ${difference.field} — migrations : ${difference.declared}`);
        console.log(`        ${difference.field} — en base    : ${difference.base}`);
      }
    }
    for (const item of report.extra) {
      console.log(
        `   ❌ ${item.table} · « ${item.name} » (${item.cmd}, ${item.roles}, ${item.expression}) — ` +
          'en base, déclarée par AUCUNE migration',
      );
    }
    for (const entry of report.exempted) {
      console.log(`   · ${entry.table}.${entry.name} : exemptée — ${entry.reason}`);
    }
    for (const problem of report.problems) console.log(`   ⚠️  ${problem}`);
  }

  if (report.vacuous) {
    console.error(
      '\n❌ Aucune politique lue dans public — l’énumération n’a rien atteint.\n' +
        '   Un catalogue vide ne prouve pas qu’il n’y a rien à voir : « je n’ai pas pu regarder » n’est pas un vert.',
    );
    process.exitCode = 2;
    return;
  }

  if (report.ok) {
    console.log(
      `\n✅ les ${report.declaredCount} politiques déclarées par les migrations sont en base, ` +
        'sans politique en trop ni condition plus étroite.',
    );
    return;
  }

  console.error(
    `\n❌ ${report.drift} politique(s) divergent entre les migrations et la base hébergée — chacune est NOMMÉE ci-dessus :\n` +
      '   • ABSENTE : une migration déclare une politique que la base ne porte pas. Deux lectures possibles, et il faut les\n' +
      '     distinguer AVANT d’appliquer quoi que ce soit — c’est un MANQUE si l’écriture qu’elle ouvre est refusée\n' +
      '     (mesuré le 2026-10-13 : l’économe et le Gestionnaire Principal en 42501), c’est au contraire une politique\n' +
      '     qu’on ne veut PAS si elle ouvre au rôle `anon` (les `Allow anonymous read access` de `init.sql` décrivent une\n' +
      '     base NEUVE, pas cet état-ci) ;\n' +
      '   • CHANGÉE : la base exécute une AUTRE règle que celle du dépôt — c’est ainsi qu’un écran montre un bouton que la\n' +
      '     base refuse (42501), ou cache une action qu’elle accepte ;\n' +
      '   • EN TROP : la base porte une politique qu’AUCUNE migration ne déclare ni ne retire. Certaines sont les règles\n' +
      '     réelles d’un rôle ; les retirer change des DROITS, donc c’est une décision (une migration qui les `DROP`),\n' +
      '     jamais un effet de bord d’un contrôle.\n' +
      '\n   Corriger un MANQUE : `npm run db:apply -- supabase/migrations/<fichier>.sql` (elle prouve AVANT et APRÈS,\n' +
      '   dans une transaction). Corriger une EN TROP ou une CHANGÉE : écrire la migration qui le dit, puis l’appliquer.\n' +
      '   Ce contrôle ne corrige rien : la décision de droits appartient à la migration, et une politique réécrite par un\n' +
      '   contrôle effacerait la preuve de ce qu’il a trouvé.',
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 2;
});
