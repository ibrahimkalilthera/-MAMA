#!/usr/bin/env node
/**
 * check-db-objects.mjs — la base hébergée porte-t-elle EXACTEMENT les INDEX, les
 * CONTRAINTES et les DÉCLENCHEURS que les migrations déclarent ?
 *
 *   npm run check:db-objects            (lecture seule ; 0 = aligné, 1 = dérive)
 *   npm run check:db-objects -- --json
 *
 * ─── Pourquoi cette commande existe ─────────────────────────────────────────
 * `check:hosted-schema` compare les COLONNES, `check:public-rls` regarde si chaque
 * table PORTE RLS, et `check:rls-policies` compare les POLITIQUES. Trois familles
 * d'objets restaient donc hors de toute garde, et chacune a une façon propre de
 * faire mal, en silence :
 *
 *   • un INDEX absent ne casse rien — il ralentit tout, et un index UNIQUE absent
 *     accepte des doublons que le dépôt croit interdits ;
 *   • une CONTRAINTE absente laisse entrer ce que le dépôt refuse d'écrire
 *     (`payments_motif_shape_check` est ce qui empêche une clé de motif illisible
 *     d'être stockée), ou laisse des lignes orphelines (clé étrangère) ;
 *   • un DÉCLENCHEUR absent est le plus silencieux des trois : l'application a
 *     cessé d'écrire les matricules, et c'est `students_assign_matricule` qui les
 *     remplit — un élève créé sans lui reste sans matricule, sans qu'aucun écran
 *     ni aucune colonne ne le dise.
 *
 * ─── Ce qu'elle compare, et par quel canal ──────────────────────────────────
 * Les objets DÉCLARÉS sont rejoués depuis `supabase/migrations/` (la source de
 * vérité dont `db:snapshot:check` prouve déjà la cohérence) : `CREATE` (re)pose,
 * `DROP` retire, `DROP TABLE` emporte ce que la table portait, dans l'ordre des
 * horodatages. Les objets RÉELS viennent de `pg_index`, `pg_constraint` et
 * `pg_trigger` par connexion DIRECTE — le catalogue ne se lit pas à travers
 * PostgREST, et une lecture qui dépendrait d'un verrou pour vérifier les verrous
 * serait circulaire. La connexion (mot de passe, hôtes, tentatives) est celle de
 * `lib/hosted-db.mjs`, la MÊME que `check:rls-policies` : deux conventions
 * finiraient par juger deux bases différentes.
 *
 * Le jugement vit dans `scripts/lib/db-objects.mjs` — pur, donc testé sans base
 * (`tests/db-objects.test.ts` l'exerce ROUGE sur un catalogue reconstitué). Ici
 * on lit, on nomme, on sort.
 *
 * ─── Ce qu'elle ne fait pas ────────────────────────────────────────────────
 * Elle ne corrige RIEN. Un index, une contrainte ou un déclencheur est une
 * décision de FORME (et parfois de droits) : un contrôle qui réécrit tout seul
 * efface la preuve de ce qu'il a trouvé. Elle NOMME, et `db:apply` applique — avec
 * sa propre preuve avant/après.
 *
 * Sortie : 0 = aligné ; 1 = dérive nommée (absent, en trop, ou changé) ;
 * 2 = pas de verdict possible (mot de passe absent, catalogue illisible, corpus
 * vide) — « je n'ai pas pu regarder » n'est pas un vert.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONSTRAINT_DRIFT_SQL,
  INDEX_DRIFT_SQL,
  TRIGGER_DRIFT_SQL,
  declaredObjectsAndRetired,
  hostedObjectsFromRows,
  judgeObjectDrift,
  watchedTables,
} from './lib/db-objects.mjs';
import { connectHostedDb, readDbPassword } from './lib/hosted-db.mjs';
import { SHARED_PROJECT_REF } from './lib/shared-project.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(root, 'supabase', 'migrations');

const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Comparer les index, les contraintes et les déclencheurs de la base hébergée aux migrations.

  npm run check:db-objects [options]

  (aucune option)   comparer, nommer chaque dérive, sortir en 1 s'il y en a une
  --json            rendre le rapport en JSON sur la sortie standard
  --help

Cette commande n'écrit RIEN : ni en base, ni ailleurs. Un index, une contrainte ou
un déclencheur est une forme (et parfois un droit) — nommer la dérive est son
travail, pas la corriger.`);
  process.exit(0);
}

/**
 * Les objets qu'on accepte de trouver EN BASE sans qu'une migration les déclare,
 * avec leur raison.
 *
 * Aucun aujourd'hui, et ce n'est pas un oubli : un index ou une contrainte posés à
 * la main sont exactement ce que ce contrôle existe pour montrer (c'est ainsi
 * qu'une contrainte posée « juste pour tester » reste des mois). Le jour où une
 * exception serait réclamée — un index de performance ajouté par un opérateur,
 * par exemple — elle s'écrit ici AVEC sa raison, et le jugement refuse une
 * exemption muette, périmée, ou qui cacherait un objet que les migrations
 * déclarent.
 */
const EXEMPTIONS = [];

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
const { declared, tables, retired } = declaredObjectsAndRetired(migrations);
const declaredCount = Object.values(declared).reduce((total, family) => total + family.size, 0);
// Ce qui est LU est borné par ce que le corpus POSSÈDE : les index et les
// contraintes des tables qu'il crée, et les déclencheurs de toute table qu'un
// déclencheur déclaré cible (`auth.users` compris). Lire tout `public` serait plus
// large et moins juste, et lire tout `auth` noierait les vraies dérives sous les
// contraintes que Supabase pose lui-même.
const watched = watchedTables(tables);

if (migrations.length === 0 || declaredCount === 0) {
  console.error(
    `❌ ${migrations.length} migration(s) lue(s), ${declaredCount} objet(s) déclaré(s) — ` +
      'il n’y a rien à comparer. Un contrôle qui n’a pas lu son corpus ne prouve rien.',
  );
  process.exit(2);
}

const PASSWORD = readDbPassword(root);
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
  let hosted;
  try {
    const indexes = (await client.query(INDEX_DRIFT_SQL, [watched.owned.schemas, watched.owned.tables])).rows;
    const constraints = (await client.query(CONSTRAINT_DRIFT_SQL, [watched.owned.schemas, watched.owned.tables])).rows;
    const triggers = (await client.query(TRIGGER_DRIFT_SQL, [watched.targeted.schemas, watched.targeted.tables])).rows;
    hosted = hostedObjectsFromRows({ indexes, constraints, triggers });
    report = judgeObjectDrift({ declared: { ...declared, retired }, hosted, exemptions: EXEMPTIONS });
  } finally {
    await client.end().catch(() => undefined);
  }

  if (AS_JSON) {
    process.stdout.write(
      `${JSON.stringify(
        {
          project: SHARED_PROJECT_REF,
          watched,
          migrations: migrations.length,
          declared: report.declaredCount,
          hosted: report.hostedCount,
          matched: report.matched,
          indexes: { declared: declared.indexes.size, hosted: hosted.indexes.size },
          constraints: { declared: declared.constraints.size, hosted: hosted.constraints.size },
          triggers: { declared: declared.triggers.size, hosted: hosted.triggers.size },
          missing: report.missing,
          extra: report.extra,
          changed: report.changed,
          retired: report.retired,
          unmodeled: report.unmodeled,
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
    console.log(`Index, contraintes, déclencheurs — base partagée ${SHARED_PROJECT_REF}`);
    console.log(`Migrations lues                   : ${migrations.length}`);
    console.log(`Tables lues (index, contraintes)  : ${watched.owned.tables.length} — ${watched.owned.schemas.join(', ')}`);
    console.log(`Tables lues (déclencheurs)        : ${watched.targeted.tables.length} — ${watched.targeted.schemas.join(', ')}`);
    console.log(`Objets déclarés                   : ${report.declaredCount}`);
    console.log(`   · index                        : ${declared.indexes.size} déclaré(s), ${hosted.indexes.size} en base`);
    console.log(`   · contraintes                  : ${declared.constraints.size} déclarée(s), ${hosted.constraints.size} en base`);
    console.log(`   · déclencheurs                 : ${declared.triggers.size} déclaré(s), ${hosted.triggers.size} en base`);
    console.log(`Alignés                           : ${report.matched}`);
    // Un objet déclaré puis RETIRÉ par le corpus n'est pas un manque : c'est un
    // retrait, il se NOMME ici, et sa CAUSE est dite (un `DROP` explicite, une
    // colonne retirée, une table retirée) plutôt que résumée en « disparu ».
    for (const entry of report.retired) {
      const why = entry.cause === 'drop-table' ? 'retire la table' : entry.cause === 'drop-column' ? 'retire la colonne' : 'le retire';
      console.log(
        `   · ${entry.kind} ${entry.schema}.${entry.table ? `${entry.table}.` : ''}${entry.name} — déclaré par ${entry.declaredBy}, plus réclamé : ${entry.droppedBy} ${why}`,
      );
    }
    for (const item of report.missing) {
      console.log(
        `   ❌ ${item.kind} ${item.schema}.${item.table ? `${item.table}.` : ''}${item.name} — déclaré par ${item.file}` +
          `${item.type ? ` (${item.type})` : ''}, ABSENT du catalogue`,
      );
    }
    for (const item of report.changed) {
      console.log(`   ❌ ${item.kind} ${item.schema}.${item.table ? `${item.table}.` : ''}${item.name} — déclaré par ${item.file}, mais la base dit autre chose :`);
      for (const difference of item.differences) {
        console.log(`        ${difference.field} — migrations : ${difference.declared}`);
        console.log(`        ${difference.field} — en base    : ${difference.base}`);
      }
    }
    for (const item of report.extra) {
      console.log(
        `   ❌ ${item.kind} ${item.schema}.${item.table ? `${item.table}.` : ''}${item.name} (${item.detail}) — en base, déclaré par AUCUNE migration`,
      );
    }
    // Un objet que ce modèle ne compare pas se DIT : le taire ferait croire qu'il a
    // été jugé (les contraintes NOT NULL de PostgreSQL 18 en seront un jour).
    for (const entry of report.unmodeled) {
      console.log(`   · ${entry.kind} ${entry.table}.${entry.name} — type « ${entry.type} », hors du modèle comparé (ni aligné, ni dérive)`);
    }
    for (const entry of report.exempted) {
      console.log(`   · ${entry.kind} ${entry.table ? `${entry.table}.` : ''}${entry.name} : exempté — ${entry.reason}`);
    }
    for (const problem of report.problems) console.log(`   ⚠️  ${problem}`);
  }

  if (report.vacuous) {
    console.error(
      '\n❌ Aucun objet lu dans les schémas déclarés — l’énumération n’a rien atteint.\n' +
        '   Un catalogue vide ne prouve pas qu’il n’y a rien à voir : « je n’ai pas pu regarder » n’est pas un vert.',
    );
    process.exitCode = 2;
    return;
  }

  if (report.ok) {
    console.log(
      `\n✅ les ${report.declaredCount} index, contraintes et déclencheurs déclarés par les migrations sont en base, ` +
        'sans objet en trop ni définition changée.',
    );
    return;
  }

  console.error(
    `\n❌ ${report.drift} objet(s) divergent entre les migrations et la base hébergée — chacun est NOMMÉ ci-dessus :\n` +
      '   • ABSENT : une migration déclare un index, une contrainte ou un déclencheur que la base ne porte pas. C’est un\n' +
      '     MANQUE si l’objet protège une écriture (une contrainte de forme, une clé étrangère, un déclencheur de\n' +
      '     remplissage) ; c’est un simple RALENTISSEMENT s’il ne sert qu’aux lectures — et dans les deux cas c’est une\n' +
      '     migration à appliquer ;\n' +
      '   • CHANGÉ : la base applique une AUTRE règle que celle du dépôt (colonne ajoutée à une contrainte UNIQUE,\n' +
      '     expression de CHECK élargie, déclencheur désactivé) — c’est ainsi qu’un écran croit une garantie que la base\n' +
      '     n’applique plus ;\n' +
      '   • EN TROP : la base porte un objet qu’AUCUNE migration ne déclare ni ne retire. Certains sont d’anciens index de\n' +
      '     performance ; les retirer change des temps de réponse ou des garanties, donc c’est une décision (une migration\n' +
      '     qui les `DROP`), jamais un effet de bord d’un contrôle.\n' +
      '\n   Corriger un MANQUE : `npm run db:apply -- supabase/migrations/<fichier>.sql` (elle prouve AVANT et APRÈS, dans une\n' +
      '   transaction). Corriger un CHANGÉ ou un EN TROP : écrire la migration qui le dit, puis l’appliquer. Ce contrôle ne\n' +
      '   corrige rien : la décision de forme appartient à la migration, et un objet réécrit par un contrôle effacerait la\n' +
      '   preuve de ce qu’il a trouvé.',
  );
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n❌ ${error.message}`);
  process.exitCode = 2;
});
